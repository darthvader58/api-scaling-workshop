const assert = require('node:assert/strict');
const base = process.argv[2] || 'http://gateway:8080';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, options = {}) {
  return fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
}
async function json(path, status = 200, options) {
  const response = await request(path, options);
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
  return response.json();
}
async function main() {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { ready = (await request('/ready')).ok; } catch { /* startup */ }
    if (ready) break;
    await sleep(1000);
  }
  assert(ready, 'Gateway did not become ready within 30 attempts');
  assert.equal((await json('/health')).status, 'ok');
  assert((await json('/api/v1/static')).message);
  assert.equal((await json('/api/v1/records/42')).record.id, 42);
  await json('/api/v1/records/nope', 400);
  await json('/api/v1/records/2147483647', 404);
  await json('/api/v1/cached-records/42');
  assert.equal((await json('/api/v1/cached-records/42')).source, 'redis');
  const metrics = await request('/metrics');
  assert(metrics.ok);
  assert((await metrics.text()).includes('workshop_http_requests_total'));
  console.log('PASS readiness, static, PostgreSQL, validation, cache hit, metrics');

  let limited = false;
  for (let i = 0; i < 1000; i++) {
    const response = await request('/api/v1/rate-limited');
    await response.text();
    assert([200, 429].includes(response.status));
    if (response.status === 429) {
      assert(Number(response.headers.get('retry-after')) > 0);
      limited = true;
      break;
    }
  }
  assert(limited, 'No 429 within 1000 requests; smoke test expects a limit below 1000');
  console.log('PASS Redis rate limiting (consumes this client’s current quota)');

  const payload = { student: 'smoke-test', nested: { ok: true } };
  const job = await json('/api/v1/jobs', 202, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'demo-work', payload })
  });
  for (let i = 0; i < 60; i++) {
    const status = await json(job.statusUrl);
    assert.deepEqual(status.payload, payload);
    if (status.status === 'completed') {
      assert(status.completedAt);
      console.log(`PASS job ${job.jobId} completed; smoke test passed`);
      return;
    }
    await sleep(1000);
  }
  throw new Error(`Job ${job.jobId} did not complete within 60 attempts`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
