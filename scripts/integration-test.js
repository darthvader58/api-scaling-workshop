// Instructor regression check: Node 22+ on the host, a running default stack,
// and three API replicas. Stops/restarts only this Compose project's worker/Redis.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base = 'http://localhost:8080';
function compose(args, env = {}) {
  return execFileSync('docker', ['compose', ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000
  }).trim();
}
async function get(path, options = {}) {
  return fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
}
async function until(check, label, seconds = 60) {
  for (let i = 0; i < seconds * 5; i++) {
    if (await check()) return;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}
async function submit() {
  const response = await get('/api/v1/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'demo-work', payload: { student: 'regression', nested: [1, 2] } })
  });
  assert.equal(response.status, 202);
  return response.json();
}
async function jobStatus(job) {
  const response = await get(job.statusUrl);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.deepEqual(status.payload, { student: 'regression', nested: [1, 2] });
  return status.status;
}
async function main() {
  const instances = new Set();
  await until(async () => {
    const response = await get('/api/v1/static');
    assert.equal(response.status, 200);
    instances.add(response.headers.get('x-api-instance'));
    await response.text();
    return instances.size === 3 && !instances.has(null);
  }, 'three routed API instances');
  console.log('PASS HAProxy routes all three replicas:', [...instances]);

  await until(async () => {
    const response = await fetch('http://localhost:9090/api/v1/targets');
    const result = await response.json();
    const targets = result.data.activeTargets.filter((target) => target.labels.job === 'workshop-api');
    return targets.length === 3 && targets.every((target) => target.health === 'up');
  }, 'three healthy Prometheus targets');
  const dashboardResponse = await fetch('http://localhost:3001/api/dashboards/uid/workshop');
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.dashboard.panels.length, 6);
  const dsResponse = await fetch('http://localhost:3001/api/datasources/uid/workshop-prometheus/health');
  assert.equal(dsResponse.status, 200);
  console.log('PASS Prometheus replica discovery and anonymous Grafana dashboard/datasource');

  for (const path of ['/api/v1/records/nope', '/api/v1/records/-1', '/api/v1/cached-records/2147483648']) {
    const response = await get(path);
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.equal((await get('/api/v1/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"payload":"bad"}'
  })).status, 400);
  console.log('PASS invalid record IDs and job payload rejected');

  // Avoid the fixed-minute boundary. Only delete the disposable rate counters.
  if (Date.now() % 60000 > 45000) await sleep(61000 - Date.now() % 60000);
  compose(['exec', '-T', 'redis', 'redis-cli', 'EVAL',
    "for _,k in ipairs(redis.call('keys','rate:*')) do redis.call('del',k) end return 1", '0']);
  const rateInstances = new Set();
  for (let i = 1; i <= 61; i++) {
    const response = await get('/api/v1/rate-limited', { headers: { 'x-forwarded-for': `198.51.100.${i}` } });
    rateInstances.add(response.headers.get('x-api-instance'));
    assert.equal(response.status, i <= 60 ? 200 : 429);
    if (i <= 60) assert.equal((await response.json()).count, i);
    else assert(Number(response.headers.get('retry-after')) > 0);
  }
  assert.equal(rateInstances.size, 3);
  // A request from the API container has a different source IP and a fresh quota.
  const independent = compose(['exec', '-T', 'api', 'node', '-e',
    "fetch('http://gateway:8080/api/v1/rate-limited').then(async r => console.log(r.status, await r.text()))"]);
  assert(independent.startsWith('200 '), independent);
  console.log('PASS shared 60-request quota across replicas, spoof rejection, client isolation');

  try {
    compose(['stop', 'worker']);
    const queued = await submit();
    assert.equal(await jobStatus(queued), 'queued');
    assert.equal(compose(['exec', '-T', 'redis', 'redis-cli', 'TTL', `job:${queued.jobId}`]), '-1');
    compose(['start', 'worker']);
    await until(async () => (await jobStatus(queued)) === 'completed', 'queued job completion');
    console.log('PASS paused-worker backlog and nonexpiring queued status');

    compose(['up', '-d', '--no-deps', '--force-recreate', 'worker'], { WORKER_DELAY_MS: '5000' });
    const interrupted = await submit();
    await until(async () => (await jobStatus(interrupted)) === 'processing', 'worker started job');
    compose(['kill', '-s', 'SIGKILL', 'worker']);
    compose(['start', 'worker']);
    await until(async () => (await jobStatus(interrupted)) === 'completed', 'reclaimed job completion');
    const ttl = Number(compose(['exec', '-T', 'redis', 'redis-cli', 'TTL', `job:${interrupted.jobId}`]));
    assert(ttl > 0 && ttl <= 3600);
    assert.equal(compose(['exec', '-T', 'redis', 'redis-cli', 'XLEN', 'work:jobs:stream']), '0');
    console.log('PASS worker SIGKILL recovery, completion retention, acknowledged stream drained');
  } finally {
    compose(['up', '-d', '--no-deps', '--force-recreate', 'worker']);
  }

  try {
    compose(['stop', 'redis']);
    const readiness = compose(['exec', '-T', 'api', 'node', '-e',
      "fetch('http://localhost:3000/ready').then(r => console.log(r.status))"]);
    assert.equal(readiness, '503');
    console.log('PASS dependency outage returns not-ready');
  } finally {
    compose(['start', 'redis']);
  }
  await until(async () => {
    try { return (await get('/ready')).ok; } catch { return false; }
  }, 'readiness after Redis restart');
  const recovered = await submit();
  await until(async () => (await jobStatus(recovered)) === 'completed', 'queue after Redis restart');
  console.log('PASS Redis reconnect and queue recovery; integration checks passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
