const Fastify = require('fastify');
const { Pool } = require('pg');
const { createClient } = require('redis');
const clientMetrics = require('prom-client');
const crypto = require('node:crypto');

// Only the gateway is published; Compose opts in to trusting private-network peers.
const app = Fastify({
  logger: true,
  disableRequestLogging: true,
  trustProxy: process.env.TRUST_PROXY === 'true' ? ['uniquelocal'] : false
});
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL || 'postgres://workshop:workshop@localhost:5432/workshop';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const poolMax = Number(process.env.DB_POOL_MAX || 10);
if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error('DB_POOL_MAX must be a positive integer');
const pool = new Pool({
  connectionString: databaseUrl,
  max: poolMax,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 2000
});
const redis = createClient({ url: redisUrl, disableOfflineQueue: true });
redis.on('error', (error) => app.log.error({ err: error }, 'Redis connection error'));
pool.on('error', (error) => app.log.error({ err: error }, 'PostgreSQL idle client error'));
const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
if (!Number.isInteger(limit) || limit < 1) throw new Error('RATE_LIMIT_PER_MINUTE must be a positive integer');
const recordOptions = { schema: { params: {
  type: 'object', required: ['id'], properties: {
    id: { type: 'integer', minimum: 1, maximum: 2147483647 }
  }
} } };

const register = new clientMetrics.Registry();
clientMetrics.collectDefaultMetrics({ register });
const requests = new clientMetrics.Counter({
  name: 'workshop_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['route', 'method', 'status'],
  registers: [register]
});
const latency = new clientMetrics.Histogram({
  name: 'workshop_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['route', 'method'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register]
});
const redisHits = new clientMetrics.Counter({
  name: 'workshop_redis_cache_hits_total',
  help: 'Redis cache hits',
  registers: [register]
});
const redisMisses = new clientMetrics.Counter({
  name: 'workshop_redis_cache_misses_total',
  help: 'Redis cache misses',
  registers: [register]
});
const jobsEnqueued = new clientMetrics.Counter({
  name: 'workshop_jobs_enqueued_total',
  help: 'Jobs added to the asynchronous queue',
  registers: [register]
});

for (const [name, help, read] of [
  ['total', 'Open database connections', () => pool.totalCount],
  ['idle', 'Idle database connections', () => pool.idleCount],
  ['waiting', 'Requests waiting for a database connection', () => pool.waitingCount]
]) {
  new clientMetrics.Gauge({
    name: `workshop_db_pool_${name}`, help, registers: [register],
    collect() { this.set(read()); }
  });
}

app.addHook('onRequest', async (request) => {
  request.workshopStart = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  const elapsed = Number(process.hrtime.bigint() - request.workshopStart) / 1e9;
  const route = request.routeOptions?.url || 'unmatched';
  requests.inc({ route, method: request.method, status: String(reply.statusCode) });
  latency.observe({ route, method: request.method }, elapsed);
});

app.get('/health', async () => ({ status: 'ok' }));
app.get('/ready', async (_request, reply) => {
  try {
    if (!redis.isReady) throw new Error('Redis is not ready');
    await Promise.all([pool.query('SELECT 1 FROM records LIMIT 1'), redis.ping()]);
    return { status: 'ready' };
  } catch (error) {
    app.log.warn({ err: error }, 'Dependencies unavailable');
    return reply.code(503).send({ status: 'not ready' });
  }
});
app.addHook('onSend', async (_request, reply) => {
  reply.header('X-API-Instance', process.env.HOSTNAME || 'native');
});

app.get('/metrics', async (_request, reply) => {
  reply.type(register.contentType);
  return register.metrics();
});

app.get('/api/v1/static', async () => ({
  message: 'Fast path: no database and no Redis',
  timestamp: new Date().toISOString()
}));

app.get('/api/v1/cpu', async () => {
  let digest = 'seed';
  for (let i = 0; i < 2000; i += 1) {
    digest = crypto.createHash('sha256').update(`${digest}:${i}`).digest('hex');
  }
  return { digest };
});

app.get('/api/v1/records/:id', recordOptions, async (request, reply) => {
  const id = Number(request.params.id);
  const result = await pool.query('SELECT id, payload, created_at FROM records WHERE id = $1', [id]);
  if (result.rowCount === 0) return reply.code(404).send({ error: 'record not found' });
  return { source: 'postgres', record: result.rows[0] };
});

app.get('/api/v1/cached-records/:id', recordOptions, async (request, reply) => {
  const id = Number(request.params.id);
  const key = `record:${id}`;
  const cached = await redis.get(key);
  if (cached) {
    redisHits.inc();
    return { source: 'redis', record: JSON.parse(cached) };
  }
  redisMisses.inc();
  const result = await pool.query('SELECT id, payload, created_at FROM records WHERE id = $1', [id]);
  if (result.rowCount === 0) return reply.code(404).send({ error: 'record not found' });
  await redis.set(key, JSON.stringify(result.rows[0]), { EX: 60 });
  return { source: 'postgres-then-redis', record: result.rows[0] };
});

app.get('/api/v1/rate-limited', async (request, reply) => {
  const bucket = Math.floor(Date.now() / 60000);
  const key = `rate:${request.ip}:${bucket}`;
  // A transaction prevents a counter from being left without an expiry.
  const [count] = await redis.multi().incr(key).expire(key, 61).exec();
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', Math.max(0, limit - count));
  if (count > limit) {
    reply.header('Retry-After', 60 - Math.floor((Date.now() / 1000) % 60));
    return reply.code(429).send({ error: 'rate limit exceeded' });
  }
  return { allowed: true, count, limit };
});

app.post('/api/v1/jobs', { schema: { body: {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', minLength: 1, maxLength: 100 },
    payload: { type: 'object', additionalProperties: true }
  }
} } }, async (request, reply) => {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    type: request.body?.type || 'demo-work',
    payload: request.body?.payload || {},
    status: 'queued',
    createdAt: new Date().toISOString()
  };
  // Hash values must be strings. Queue and status become visible atomically.
  // Queued/processing jobs do not expire; retention begins after completion.
  await redis.multi()
    .hSet(`job:${jobId}`, { ...job, payload: JSON.stringify(job.payload) })
    .xAdd('work:jobs:stream', '*', { job: JSON.stringify(job) })
    .exec();
  jobsEnqueued.inc();
  return reply.code(202).send({ jobId, statusUrl: `/api/v1/jobs/${jobId}` });
});

app.get('/api/v1/jobs/:id', async (request, reply) => {
  const job = await redis.hGetAll(`job:${request.params.id}`);
  if (!job.id) return reply.code(404).send({ error: 'job not found' });
  return { ...job, payload: JSON.parse(job.payload) };
});

async function start() {
  await redis.connect();
  await pool.query('SELECT 1 FROM records LIMIT 1');
  await app.listen({ port, host: '0.0.0.0' });
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  try {
    await app.close();
    await pool.end();
    if (redis.isOpen) await redis.disconnect(); // node-redis 4 API
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
