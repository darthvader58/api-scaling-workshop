const Fastify = require('fastify');
const { Pool } = require('pg');
const { createClient } = require('redis');
const clientMetrics = require('prom-client');
const crypto = require('node:crypto');

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL || 'postgres://workshop:workshop@localhost:5432/workshop';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 2000
});
const redis = createClient({ url: redisUrl });

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

app.addHook('onRequest', async (request) => {
  request.workshopStart = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  const elapsed = Number(process.hrtime.bigint() - request.workshopStart) / 1e9;
  const route = request.routeOptions?.url || request.url.split('?')[0];
  requests.inc({ route, method: request.method, status: String(reply.statusCode) });
  latency.observe({ route, method: request.method }, elapsed);
});

app.get('/health', async () => ({ status: 'ok' }));

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

app.get('/api/v1/records/:id', async (request, reply) => {
  const id = Number(request.params.id);
  const result = await pool.query('SELECT id, payload, created_at FROM records WHERE id = $1', [id]);
  if (result.rowCount === 0) return reply.code(404).send({ error: 'record not found' });
  return { source: 'postgres', record: result.rows[0] };
});

app.get('/api/v1/cached-records/:id', async (request, reply) => {
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
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
  const bucket = Math.floor(Date.now() / 60000);
  const key = `rate:${request.ip}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 61);
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', Math.max(0, limit - count));
  if (count > limit) {
    reply.header('Retry-After', 60 - Math.floor((Date.now() / 1000) % 60));
    return reply.code(429).send({ error: 'rate limit exceeded' });
  }
  return { allowed: true, count, limit };
});

app.post('/api/v1/jobs', async (request, reply) => {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    type: request.body?.type || 'demo-work',
    payload: request.body?.payload || {},
    status: 'queued',
    createdAt: new Date().toISOString()
  };
  await redis.hSet(`job:${jobId}`, job);
  await redis.expire(`job:${jobId}`, 3600);
  await redis.lPush('work:jobs', JSON.stringify(job));
  jobsEnqueued.inc();
  return reply.code(202).send({ jobId, statusUrl: `/api/v1/jobs/${jobId}` });
});

app.get('/api/v1/jobs/:id', async (request, reply) => {
  const job = await redis.hGetAll(`job:${request.params.id}`);
  if (!job.id) return reply.code(404).send({ error: 'job not found' });
  return job;
});

async function start() {
  await redis.connect();
  await pool.query('SELECT 1');
  await app.listen({ port, host: '0.0.0.0' });
}

async function shutdown() {
  await app.close();
  await pool.end();
  if (redis.isOpen) await redis.quit();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
