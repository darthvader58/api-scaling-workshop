const { createClient } = require('redis');
const { randomUUID } = require('node:crypto');

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  disableOfflineQueue: true
});
redis.on('error', (error) => console.error('Worker Redis connection error:', error.message));
const delayMs = Number(process.env.WORKER_DELAY_MS || 250);
// Keep demo work below the reclaim timeout; real work needs leases/heartbeats.
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) {
  throw new Error('WORKER_DELAY_MS must be an integer between 0 and 5000');
}
const stream = 'work:jobs:stream';
const group = 'workshop-workers';
const consumer = randomUUID();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function processJob(item) {
  let job;
  try {
    job = JSON.parse(item.message.job);
    if (!job.id || typeof job.id !== 'string') throw new Error('Invalid job ID');
  } catch (error) {
    // Keep malformed messages for inspection without blocking other work.
    await redis.multi()
      .xAdd('work:jobs:failed', '*', { original: JSON.stringify(item), error: error.message })
      .xAck(stream, group, item.id).xDel(stream, item.id).exec();
    console.error('Malformed job moved to work:jobs:failed', item.id);
    return;
  }
  await redis.hSet(`job:${job.id}`, {
    status: 'processing', startedAt: new Date().toISOString()
  });
  console.log(`processing job ${job.id}`);
  await sleep(delayMs); // Simulated work only: job.type does not send email or reports.
  await redis.multi()
    .hSet(`job:${job.id}`, { status: 'completed', completedAt: new Date().toISOString() })
    .expire(`job:${job.id}`, 3600)
    .xAck(stream, group, item.id).xDel(stream, item.id).exec();
  console.log(`completed job ${job.id}`);
}

async function run() {
  await redis.connect();
  try {
    await redis.xGroupCreate(stream, group, '0', { MKSTREAM: true });
  } catch (error) {
    if (!error.message.includes('BUSYGROUP')) throw error;
  }
  console.log(`worker ready; simulated work delay=${delayMs}ms`);
  let cursor = '0-0';
  while (!stopping) {
    // Redis retains unacknowledged deliveries after a crash. Reclaim after 30s.
    const recovered = await redis.xAutoClaim(stream, group, consumer, 30000, cursor, { COUNT: 1 });
    cursor = recovered.nextId;
    let items = recovered.messages.filter(Boolean);
    if (!items.length) {
      const result = await redis.xReadGroup(group, consumer, { key: stream, id: '>' }, { COUNT: 1, BLOCK: 1000 });
      items = result?.[0]?.messages || [];
    }
    for (const item of items) await processJob(item);
  }
  await redis.quit();
  console.log('worker stopped after finishing current job');
}

run().catch((error) => {
  console.error(error);
  // Unacknowledged work is recoverable on restart.
  process.exit(1);
});
