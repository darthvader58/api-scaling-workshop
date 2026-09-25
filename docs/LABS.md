# Student Lab Guide

Run the labs in order. Record the output from every benchmark so you can explain the effect of each change.

## Lab 0: Start the system

```bash
docker compose up --build -d --wait
curl http://localhost:8080/health
```

Check:

```bash
docker compose ps
```

## Lab 1: Baseline API

Benchmark the route with no database and no Redis:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/static 15 100
```

Record:

- requests per second;
- average latency;
- p99 latency;
- transport errors, timeouts, successful responses, and HTTP status counts;
- Docker CPU usage.

Run `docker stats --no-stream` in a second terminal. Record host CPU/RAM, Docker CPU/memory allocation, API replica count, pool size, route, duration, connections, cache state, response bytes, and status counts. Warm up once and repeat each benchmark three times; compare medians and variability. Keep background activity and settings consistent. Reported `0 ms` percentiles mean below the timer/reporting resolution, not zero latency. The load generator shares laptop resources with the server.

Question: What resource becomes saturated first?

## Lab 2: CPU work and horizontal scaling

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cpu 15 100
docker compose up --build -d --scale api=3
docker compose run --rm loadtest http://gateway:8080/api/v1/cpu 15 100
```

Run `docker compose ps` after the benchmark to confirm three API replicas remain. HAProxy supports up to 10 replicas in this lab.

Question: Did three containers produce three times the throughput? Why or why not?

## Lab 3: PostgreSQL bottleneck

Return to one replica to isolate pool tuning:

```bash
docker compose up -d --scale api=1 --wait
```

Benchmark the database route:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 15 100
```

Inspect database logs:

```bash
docker compose logs --tail=50 db
```

Copy `.env.example` to `.env`, set `DB_POOL_MAX=2`, recreate the API, and benchmark again. Then try 20 and restore 10. Do not assume a larger pool is faster. Pool capacity is **per replica**: three replicas with a pool of 20 can open 60 connections. Leave room for administrative and other connections.

```bash
docker compose up -d --build --force-recreate --scale api=1 --wait api
```

Inspect `workshop_db_pool_waiting` in Prometheus/the dashboard. This indexed lookup over 10,000 rows may remain in PostgreSQL memory: a database bottleneck is a hypothesis to test, not a guaranteed outcome. Do not claim disk saturation from latency alone.

Question: When does pool contention or database capacity become the bottleneck?

## Lab 4: Redis caching

Clear the cache first:

```bash
docker compose exec -T redis redis-cli DEL record:42
```

Warm the key with two sequential requests. The first should report `postgres-then-redis`, and the second `redis`:

```bash
curl http://localhost:8080/api/v1/cached-records/42
curl http://localhost:8080/api/v1/cached-records/42
```

Run the cached route:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cached-records/42 15 100
```

Check keys:

```bash
docker compose exec -T redis redis-cli --scan --pattern 'record:*'
```

Open `http://localhost:3001/d/workshop` and inspect the cache metrics. Concurrent cold requests can all miss (a cache stampede). Clearing only `record:42` preserves jobs and rate counters.

Questions:

- What happens when the key expires?
- What if the database record changes?
- What if every request asks for a different ID?

## Lab 5: Rate limiting

Run a short aggressive test:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/rate-limited 10 100
```

Inspect the response headers manually:

```bash
curl -i http://localhost:8080/api/v1/rate-limited
```

AutoCannon reports HTTP status counts: 429 responses are expected here and are not successful business throughput. Transport errors/timeouts are a separate signal. The limiter is a fixed UTC-minute window, shared across replicas and keyed by the client IP seen by HAProxy. It can allow a burst across a minute boundary; students behind NAT may share an IP. The gateway replaces incoming forwarding headers. Wait until the next minute for a fresh bucket.

Question: Why is the limiter in Redis instead of an in-memory JavaScript object when there are multiple API containers?

## Lab 6: Queue and worker

Submit a job:

```bash
curl -i -X POST http://localhost:8080/api/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"generate-report","payload":{"student":"demo"}}'
```

Copy the `jobId`, then poll:

```bash
JOB_ID='paste-the-returned-job-id-here'
curl "http://localhost:8080/api/v1/jobs/$JOB_ID"
```

First stop the worker:

```bash
docker compose stop worker
```

Repeat the POST and GET above: the job should stay `queued`. Then resume processing:

```bash
docker compose start worker
docker compose logs -f worker
```

For an instructor crash-recovery demo, set `WORKER_DELAY_MS=5000` in `.env`, recreate the worker with `docker compose up -d --force-recreate worker`, submit a job, and wait for `processing`. Run `docker compose kill -s SIGKILL worker`, then `docker compose start worker`. The pending job should finish after the 30-second reclaim timeout plus work time. Restore the delay to 250 and recreate the worker afterward.

Redis Streams retain unacknowledged messages. Completion, acknowledgment, and removal are one transaction; queued/processing status does not expire, completed status expires after an hour. Delivery is at least once: a crash after an external side effect could repeat that effect, so real handlers need idempotency. This demo only sleeps. Redis AOF is enabled, but a host crash can still lose recent writes; this is not replicated durable infrastructure. Backlogs have no admission limit; reset only when workshop data can be deleted.

Question: What reliability features would a production queue need?

## Lab 7: Observability

API metrics:

```bash
curl http://localhost:8080/metrics
```

Prometheus UI: http://localhost:9090

Useful queries:

```promql
rate(workshop_http_requests_total[1m])
rate(workshop_http_request_duration_seconds_sum[1m]) / rate(workshop_http_request_duration_seconds_count[1m])
workshop_redis_cache_hits_total
workshop_redis_cache_misses_total
workshop_jobs_enqueued_total
```

Grafana dashboard: http://localhost:3001/d/workshop (anonymous read-only).

Keep traffic flowing for at least a minute for rate graphs. In Prometheus, open Status → Target health and check one healthy `workshop-api` target per replica. After scaling to three, `count(up{job="workshop-api"} == 1)` should become 3. `/metrics` through the gateway shows only the replica handling that request; Prometheus scrapes all replicas separately.

Aggregate RPS: `sum(rate(workshop_http_requests_total{route!~"/health|/ready|/metrics"}[1m]))`.

Per-route p99: `histogram_quantile(0.99, sum by (le, route) (rate(workshop_http_request_duration_seconds_bucket[1m])))`. Pool gauges and `docker stats` provide additional clues; the stack does not include database/Redis exporters.

Question: Which metric would you alert on first for a customer-facing API?

## Lab 8: The 1M RPS thought experiment

Use a sustainable measured local result at a stated latency/error target and write down:

1. How many requests/second one API container served.
2. How many containers would be required at the same rate.
3. What happens to PostgreSQL traffic with a 0%, 50%, and 99% cache hit rate.
4. How many bytes/second the response body creates.
5. Why the load generators themselves become a distributed system.
6. Which result is measured and which result is extrapolated.

Do not write “we reached 1M RPS” unless you actually measured it in a controlled environment. Write “we measured X locally and modeled 1M RPS as follows.”

### Model worksheet

Choose a sustainable **single-container** rate R at an explicit p99/error target. Do not divide an overloaded three-container result and call that independent-server capacity.

```text
T = 1,000,000 requests/s (target, not measured)
f = assumed efficiency/headroom factor between 0 and 1
API replicas = ceil(T / (R × f))
r = fraction of requests requiring a record read
h = assumed cache hit ratio
Database reads/s = T × r × (1 - h)
Cache GET/s = T × r
Cache SET/s ≈ T × r × (1 - h)
Network bytes/s = T × average response bytes
Network bits/s = 8 × network bytes/s
```

Add rate-limit Redis operations, cache invalidations, writes, and queue traffic separately. If a fraction q of requests creates jobs and one worker takes d seconds/job, workers ≥ ceil(T × q × d / assumed worker utilization). Explain how database connection limits, Redis capacity, gateway capacity, and load-generator capacity constrain the API estimate. A hit ratio is an assumption dependent on key distribution and TTL, not a guarantee.

At 1M RPS, 200-byte bodies imply 200 MB/s (1.6 Gbit/s); 30 KB bodies imply 30 GB/s (240 Gbit/s), using decimal units. HTTP/TCP/TLS overhead and internal hops add more. Include sensitivity cases for low/medium/high efficiency, response size, and cache hit ratio. These are extrapolations requiring independent production validation.
