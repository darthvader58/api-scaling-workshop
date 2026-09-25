const autocannon = require('autocannon');

const target = process.argv[2] || process.env.TARGET || 'http://localhost:8080/api/v1/static';
const duration = Number(process.argv[3] || process.env.DURATION || 15);
const connections = Number(process.argv[4] || process.env.CONNECTIONS || 100);

if (!Number.isInteger(duration) || duration < 1 || !Number.isInteger(connections) || connections < 1) {
  console.error('Usage: target-url duration-seconds connections (positive integers)');
  process.exit(1);
}
try {
  if (!['http:', 'https:'].includes(new URL(target).protocol)) throw new Error();
} catch {
  console.error('Target must be an http:// or https:// URL');
  process.exit(1);
}

console.log(JSON.stringify({ target, durationSeconds: duration, connections }, null, 2));

const instance = autocannon({
  url: target,
  duration,
  connections,
  pipelining: 1,
  timeout: 10
});

autocannon.track(instance, { renderProgressBar: true });
instance.on('error', (error) => { console.error(error); process.exitCode = 1; });
instance.on('done', (result) => {
  console.log(JSON.stringify({
    requestsPerSecond: result.requests.average,
    latencyMs: result.latency.average,
    p99LatencyMs: result.latency.p99,
    totalResponses: result.requests.total,
    successfulResponses: result['2xx'],
    non2xxResponses: result.non2xx,
    statusCodes: result.statusCodeStats,
    bytesPerSecond: result.throughput.average,
    errors: result.errors,
    timeouts: result.timeouts,
    durationSeconds: result.duration
  }, null, 2));
  // 429s are intentional in the rate-limit lab; transport errors are failures.
  if (result.errors || result.timeouts || !result.requests.total || result['5xx']) process.exitCode = 1;
});
