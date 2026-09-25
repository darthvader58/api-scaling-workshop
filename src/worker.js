const { createClient } = require('redis');

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
const delayMs = Number(process.env.WORKER_DELAY_MS || 250);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  await redis.connect();
  console.log(`worker ready; simulated work delay=${delayMs}ms`);
  while (true) {
    const item = await redis.brPop('work:jobs', 0);
    const job = JSON.parse(item.element);
    await redis.hSet(`job:${job.id}`, {
      status: 'processing',
      startedAt: new Date().toISOString()
    });
    await sleep(delayMs);
    await redis.hSet(`job:${job.id}`, {
      status: 'completed',
      completedAt: new Date().toISOString()
    });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
