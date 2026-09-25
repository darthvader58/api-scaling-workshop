# Student Lab Guide

Run the labs in order. Record the output from every benchmark so you can explain the effect of each change.

## Lab 0: Start the system

```bash
docker compose up --build -d
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
- errors and timeouts;
- Docker CPU usage.

Question: What resource becomes saturated first?

## Lab 2: CPU work and horizontal scaling

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cpu 15 100
docker compose up --build -d --scale api=3
docker compose run --rm loadtest http://gateway:8080/api/v1/cpu 15 100
```

Question: Did three containers produce three times the throughput? Why or why not?

## Lab 3: PostgreSQL bottleneck

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 15 100
```

Inspect database logs:

```bash
docker compose logs --tail=50 db
```

Change `DB_POOL_MAX` in `docker-compose.yml` from 10 to 2, recreate the API, and benchmark again. Then try 20. Do not assume a larger pool is always faster.

```bash
docker compose up -d --build --force-recreate api
```

Question: When does pool contention or database capacity become the bottleneck?

## Lab 4: Redis caching

Clear the cache first:

```bash
docker compose exec redis redis-cli FLUSHALL
```

Run the cached route:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cached-records/42 15 100
```

Check keys:

```bash
docker compose exec redis redis-cli KEYS 'record:*'
```

Open `http://localhost:3001` and inspect Prometheus metrics if desired. The first request should miss; later requests should hit Redis.

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
curl http://localhost:8080/api/v1/jobs/<JOB_ID>
```

Stop the worker and submit another job. Start the worker again and watch the queued job complete:

```bash
docker compose stop worker
docker compose start worker
docker compose logs -f worker
```

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

Grafana: http://localhost:3001

Question: Which metric would you alert on first for a customer-facing API?

## Lab 8: The 1M RPS thought experiment

Use your best measured local result and write down:

1. How many requests/second one API container served.
2. How many containers would be required at the same rate.
3. What happens to PostgreSQL traffic with a 0%, 50%, and 99% cache hit rate.
4. How many bytes/second the response body creates.
5. Why the load generators themselves become a distributed system.
6. Which result is measured and which result is extrapolated.

Do not write “we reached 1M RPS” unless you actually measured it in a controlled environment. Write “we measured X locally and modeled 1M RPS as follows.”
