# Student Lab Manual: Scaling an API from One Laptop to a 1M RPS Model

This manual is the hands-on part of the workshop. You will run a local API stack, measure how it behaves, and use those measurements to build a capacity model.

The goal is not to prove that your laptop can serve 1,000,000 requests per second. It cannot. The goal is to learn how engineers move from a small measured system to a defensible model for a much larger system.

By the end, you should be able to explain:

- what each service in the stack does;
- what happens to a request as it moves through the system;
- how load testing differs from normal manual testing;
- why PostgreSQL can become a bottleneck;
- why connection pools exist;
- how Redis helps with caching, rate limiting, and queues;
- how horizontal scaling changes the shape of the system;
- how Prometheus and Grafana help you observe behavior;
- how to separate measured results from extrapolated capacity estimates.

Run the labs in order. Each lab builds on the earlier ones.

## Important names in this workshop

Students often hear similar-sounding technology names. Here is what this repository actually uses.

| Name | What it means here | Why it matters |
| --- | --- | --- |
| API | Application Programming Interface | The HTTP service students call with `curl` and benchmark with the load tester. |
| Fastify | A Node.js web framework | The API server in `src/server.js` is built with Fastify. It is not Python FastAPI. |
| FastAPI | A Python web framework | Useful technology, but not part of this repository. |
| Auth0 | A hosted authentication service | Not used in this workshop. No Auth0 account, login provider, or cloud credential is required. |
| AutoCannon | A Node.js HTTP load-testing tool | The `loadtest` container uses it to send many requests to the API. |
| Docker Compose | The tool that starts the multi-container stack | It starts PostgreSQL, Redis, API, worker, gateway, Prometheus, Grafana, and the load-test container. |
| HAProxy | The local reverse proxy and load balancer | Students call `localhost:8080`; HAProxy forwards requests to one or more API containers. |
| PostgreSQL | The relational database | It stores the seeded `records` table used in database labs. |
| Redis | An in-memory data store | This workshop uses Redis for caching, rate limiting counters, and a queue. |
| Prometheus | Metrics collection system | It scrapes `/metrics` from API replicas. |
| Grafana | Metrics dashboard UI | It displays Prometheus metrics in a beginner-friendly dashboard. |
| RPS | Requests per second | A throughput measurement: how many HTTP requests finish each second. |
| Latency | How long a request takes | Usually measured in milliseconds. |
| p99 latency | 99th percentile latency | 99% of requests were this fast or faster; 1% were slower. |
| 2xx, 4xx, 5xx | HTTP status groups | 2xx means success, 4xx means client-side rejection or bad request, 5xx means server failure. |
| TTL | Time to live | How long a cached value should remain valid before expiring. |
| NAT | Network Address Translation | Multiple students may appear to come from one shared IP address on a classroom network. |

## The local architecture

Docker Compose creates a private network for the containers. Containers use service names, such as `api`, `db`, `redis`, and `gateway`, to talk to each other. Your laptop uses published ports on `localhost`.

```text
Your terminal
  |
  | curl http://localhost:8080/...
  v
HAProxy gateway container
  |
  | forwards to one API replica, or load-balances across several replicas
  v
Fastify API container(s)
  |          |
  |          +--> Redis for cache, rate limits, and queue status
  |
  +--> PostgreSQL for records

Worker container
  |
  +--> Redis Streams queue

Prometheus
  |
  +--> scrapes /metrics from API replicas

Grafana
  |
  +--> reads metrics from Prometheus
```

The most important idea is that there are two networks:

- On your laptop, you use `localhost:8080`, `localhost:9090`, and `localhost:3001`.
- Inside Docker, containers use service names such as `gateway:8080`, `api:3000`, `db:5432`, and `redis:6379`.

That is why manual `curl` commands usually use `localhost`, while load-test commands inside Docker use `http://gateway:8080`.

## Before you start

Install:

- Docker Desktop;
- Git;
- a terminal.

On Windows, Git Bash is the recommended terminal for these labs because the examples use Bash-style quoting and variables. PowerShell can work, but some quotes and variables need different syntax.

Verify your tools:

```bash
docker --version
docker compose version
git --version
```

From the repository root, verify the Compose file:

```bash
docker compose config
```

If this command fails, do not continue until the error is fixed. `docker compose config` checks that Docker Compose can parse the stack definition.

## How to record benchmark results

For every benchmark, write down:

- route tested, for example `/api/v1/static`;
- duration and connection count, for example `15` seconds and `100` connections;
- API replica count, for example `api=1` or `api=3`;
- `DB_POOL_MAX` value if you changed it;
- whether the cache was cold or warm;
- requests per second;
- average latency;
- p99 latency;
- successful responses;
- non-2xx responses;
- status code counts;
- transport errors and timeouts;
- Docker CPU and memory usage.

Run each important benchmark once as a warm-up, then run it three measured times. Compare the middle result instead of trusting a single lucky or unlucky run. Your laptop is running the API, database, Redis, proxy, metrics tools, and load generator at the same time, so local measurements will vary.

Use this command in another terminal during load tests:

```bash
docker stats --no-stream
```

If the load generator reports `0 ms` for a percentile, read that as "below the tool's reporting resolution," not as truly zero latency.

## Lab 0: Start the system

### What you are learning

This lab starts the complete local stack and verifies that the API is alive.

Docker Compose reads `docker-compose.yml`, builds local images, creates a private network, starts containers, and waits for health checks.

### Services started by this lab

| Service | Purpose |
| --- | --- |
| `db` | PostgreSQL database seeded with workshop records. |
| `redis` | Redis data store used by cache, rate limit, and queue labs. |
| `api` | Fastify API server. |
| `worker` | Background worker that processes queued jobs. |
| `gateway` | HAProxy reverse proxy on `localhost:8080`. |
| `prometheus` | Metrics scraper on `localhost:9090`. |
| `grafana` | Dashboard UI on `localhost:3001`. |

### Start the stack

```bash
docker compose up --build -d --wait
```

What the flags mean:

- `up` creates and starts the application stack.
- `--build` rebuilds local images before starting containers.
- `-d` runs containers in the background, also called detached mode.
- `--wait` waits for health checks before returning.

### Check the API

```bash
curl http://localhost:8080/health
```

Expected idea:

```json
{"status":"ok"}
```

`/health` only means the API process is running. Later you will use `/ready`, which checks whether dependencies such as PostgreSQL and Redis are available.

Check container status:

```bash
docker compose ps
```

You should see containers in a running or healthy state. If a service is unhealthy, inspect logs:

```bash
docker compose logs api
docker compose logs db
docker compose logs redis
docker compose logs gateway
```

### Checkpoint

Before continuing, make sure this works:

```bash
curl http://localhost:8080/api/v1/static
```

This route does not use PostgreSQL or Redis. It is the simplest path through the API.

## Lab 1: Baseline API

### What you are learning

This lab measures the simplest API route. It is the baseline for later comparisons.

A baseline is the first measurement you trust enough to compare against. Without a baseline, "faster" and "slower" are just feelings.

### What the route does

`/api/v1/static` returns a small JSON response from memory:

```json
{
  "message": "Fast path: no database and no Redis",
  "timestamp": "..."
}
```

This route still uses Fastify, HTTP, JSON serialization, HAProxy, Docker networking, and your laptop CPU. It avoids PostgreSQL and Redis so you can see the overhead of the web layer by itself.

### Run a small first test

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/static 10 25
```

Arguments:

- `docker compose run` starts a one-time container.
- `--rm` removes that one-time container after it exits.
- `loadtest` is the service that runs AutoCannon.
- `http://gateway:8080/api/v1/static` is the target URL from inside Docker.
- `10` means run for 10 seconds.
- `25` means keep 25 concurrent connections open.

This command targets `gateway`, not `localhost`, because the load-test process runs inside a Docker container. From inside Docker, `localhost` would mean the load-test container itself.

### Run the main benchmark

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/static 15 100
```

In another terminal:

```bash
docker stats --no-stream
```

Record the values listed in "How to record benchmark results."

### How to interpret the output

AutoCannon prints a live table and then a JSON summary. Focus on:

- `requestsPerSecond`: average completed requests per second;
- `latencyMs`: average request latency;
- `p99LatencyMs`: the slow edge of normal traffic;
- `successfulResponses`: HTTP 2xx responses;
- `non2xxResponses`: HTTP responses outside 2xx;
- `errors`: network or client-side transport failures;
- `timeouts`: requests that did not finish before the timeout.

A high RPS number is not useful if p99 latency is terrible or many requests fail. In a real service, the target is usually written as something like:

```text
Serve at least 5,000 RPS with p99 latency below 100 ms and error rate below 0.1%.
```

Your numbers will be different. That is fine. The important habit is to state the target.

### Checkpoint questions

- What resource looks busiest in `docker stats`?
- Does the gateway, API, or load-test container use the most CPU?
- Are there any non-2xx responses?
- Did repeated runs produce the same result or a range?

## Lab 2: CPU work and horizontal scaling

### What you are learning

This lab compares one API container with three API containers.

Horizontal scaling means adding more instances of the same service. In this workshop, scaling from one API container to three API containers is horizontal scaling.

Vertical scaling means making one machine or container bigger, such as adding more CPU or memory. We are not doing that here.

### What the route does

`/api/v1/cpu` repeatedly calculates a SHA-256 hash. SHA-256 is a cryptographic hash function: it turns input bytes into a fixed-size digest. This route is intentionally CPU-heavy, so it gives you a clearer reason to test multiple API replicas.

It does not use PostgreSQL or Redis. That matters because a shared database bottleneck can hide the benefit of API scaling.

### Test one API replica

Return to one API replica:

```bash
docker compose up -d --scale api=1 --wait
```

Benchmark:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cpu 15 100
```

Record the result.

### Scale to three API replicas

```bash
docker compose up --build -d --scale api=3
```

Check that three API containers remain running:

```bash
docker compose ps
```

Benchmark again:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cpu 15 100
```

Check the API instance header a few times:

```bash
curl -i http://localhost:8080/api/v1/static
curl -i http://localhost:8080/api/v1/static
curl -i http://localhost:8080/api/v1/static
```

Look for `X-API-Instance`. If you see different values over several requests, HAProxy is sending traffic to different API containers.

### What HAProxy is doing

HAProxy is a reverse proxy. A forward proxy acts on behalf of clients. A reverse proxy acts on behalf of servers.

In this stack, HAProxy:

- listens on `localhost:8080`;
- checks whether API replicas are healthy;
- forwards requests to healthy API replicas;
- distributes requests across replicas when you scale `api`;
- replaces incoming forwarding headers so students cannot spoof client IPs for the rate-limit lab.

The browser or `curl` never talks directly to an API container. It talks to HAProxy.

### How to interpret scaling

Three replicas rarely produce exactly three times the throughput on a laptop. Reasons include:

- all containers share the same physical CPU;
- Docker Desktop has its own CPU and memory limits;
- HAProxy and the load tester also need CPU;
- the operating system schedules many processes at once;
- network and JSON overhead do not disappear;
- the route may have some serial work that does not parallelize perfectly.

### Checkpoint questions

- Did throughput increase?
- Did p99 latency improve, worsen, or stay similar?
- Did three replicas produce exactly three times the result?
- Which shared resource limited the result?

## Lab 3: PostgreSQL and connection pooling

### What you are learning

This lab introduces database work and database connection pools.

PostgreSQL is a relational database. A relational database stores structured data in tables. This repository starts PostgreSQL locally and seeds a `records` table with sample rows.

The API does not open a new database connection for every request. Instead, it uses a connection pool.

A connection pool is a reusable set of database connections. When a request needs the database, it borrows a connection, runs a query, and returns the connection to the pool. This avoids the cost of constantly opening and closing database connections.

### Why pools can help and hurt

If the pool is too small, API requests wait for a free database connection.

If the pool is too large, the API can overload PostgreSQL with too many simultaneous queries. More connections are not automatically better.

The pool size in this workshop is controlled by:

```text
DB_POOL_MAX
```

It is per API replica. If `DB_POOL_MAX=10` and you run three API replicas, the API tier can open up to 30 PostgreSQL connections.

### What the route does

`/api/v1/records/42` runs a SQL query:

```sql
SELECT id, payload, created_at FROM records WHERE id = $1
```

SQL stands for Structured Query Language. It is the language used to ask relational databases for data.

The route returns a row from PostgreSQL:

```json
{
  "source": "postgres",
  "record": {
    "id": 42,
    "payload": "...",
    "created_at": "..."
  }
}
```

### Isolate the database experiment

Use one API replica:

```bash
docker compose up -d --scale api=1 --wait
```

Benchmark the database route:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 15 100
```

Inspect PostgreSQL logs:

```bash
docker compose logs --tail=50 db
```

### Change the pool size

If you do not already have a `.env` file, create one from the example:

```bash
cp .env.example .env
```

Open `.env` in your editor and set:

```text
DB_POOL_MAX=2
```

Recreate the API so it reads the new value:

```bash
docker compose up -d --build --force-recreate --scale api=1 --wait api
```

Benchmark again:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 15 100
```

Now try:

```text
DB_POOL_MAX=20
```

Recreate the API and benchmark again. When you are done, restore:

```text
DB_POOL_MAX=10
```

Then recreate the API one more time:

```bash
docker compose up -d --build --force-recreate --scale api=1 --wait api
```

### Observe pool pressure

Open Prometheus:

```text
http://localhost:9090
```

Try this query:

```promql
workshop_db_pool_waiting
```

This gauge shows how many requests are waiting for a database connection. A value above zero during load means the API wanted more database connections than the pool had available.

### Important interpretation warning

This lab is called "PostgreSQL bottleneck," but bottlenecks must be measured, not assumed.

The seeded table is small, and the query uses a primary key. PostgreSQL may keep the data in memory. On many laptops, this route may still be fast. That does not mean databases never bottleneck; it means this specific local experiment did not prove a database bottleneck at that moment.

Do not write "the disk was saturated" unless you measured disk saturation. Instead write something like:

```text
With DB_POOL_MAX=2, p99 latency increased and workshop_db_pool_waiting rose above zero, which suggests pool contention.
```

### Checkpoint questions

- Which pool size gave the best result on your machine?
- Did a larger pool always help?
- Did `workshop_db_pool_waiting` rise?
- What would happen to total database connections if you scaled the API to three replicas?

## Lab 4: Redis caching

### What you are learning

This lab uses Redis as a cache.

A cache stores a copy of data that is expensive or slower to fetch from the original source. Here, PostgreSQL is the source of truth and Redis stores a short-lived copy.

Redis is often used for caching because it stores data in memory and supports fast key-value operations such as `GET`, `SET`, and `DEL`.

### What the route does

`/api/v1/cached-records/42` follows this logic:

```text
1. Look for key record:42 in Redis.
2. If the key exists, return the Redis value.
3. If the key does not exist, query PostgreSQL.
4. Store the PostgreSQL result in Redis for 60 seconds.
5. Return the result.
```

The response includes a `source` field:

- `postgres-then-redis` means a cache miss happened, so the API queried PostgreSQL and then populated Redis.
- `redis` means a cache hit happened, so the API served the response from Redis.

### Clear only the cache key for this lab

```bash
docker compose exec -T redis redis-cli DEL record:42
```

What this means:

- `docker compose exec` runs a command in an existing container.
- `-T` disables an interactive terminal, which is useful for scripts and copy-paste commands.
- `redis` is the Redis service.
- `redis-cli` is the Redis command-line client.
- `DEL record:42` deletes one key.

Do not use `FLUSHALL` during normal labs. `FLUSHALL` deletes everything in Redis, including rate-limit counters and queue data.

### Warm the cache manually

Run the same request twice:

```bash
curl http://localhost:8080/api/v1/cached-records/42
curl http://localhost:8080/api/v1/cached-records/42
```

Expected idea:

- First response: `"source":"postgres-then-redis"`.
- Second response: `"source":"redis"`.

The first request is cold because Redis does not have the key yet. The second request is warm because Redis has the key.

### Benchmark the cached route

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cached-records/42 15 100
```

Check Redis keys:

```bash
docker compose exec -T redis redis-cli --scan --pattern 'record:*'
```

Open Grafana:

```text
http://localhost:3001/d/workshop
```

Look for cache hits and cache misses.

### How to interpret caching

Caching helps when many requests ask for the same data or a small working set of data.

Caching helps less when every request asks for a different record. For example, if requests are evenly spread across millions of IDs and each cache entry expires quickly, the hit rate may be low.

The cache also creates correctness questions:

- What if PostgreSQL changes but Redis still has the old value?
- What TTL should you choose?
- Should writes delete or update cache keys?
- What happens if many requests miss at the same time?

That last case is called a cache stampede. A cache stampede happens when many concurrent requests all miss the cache and all rush to the database at once.

### Checkpoint questions

- How much faster was the cached route than the uncached database route?
- What was the cache hit rate during your benchmark?
- What happens after 60 seconds?
- How would results change if every request used a random ID?

## Lab 5: Redis-backed rate limiting

### What you are learning

This lab uses Redis for rate limiting.

Rate limiting means restricting how many requests a client can make during a time window. APIs use rate limits to protect shared resources, reduce abuse, and keep one client from consuming the whole system.

This route is intentionally allowed to return HTTP 429 responses. HTTP 429 means "Too Many Requests."

### Why Redis is used

If there is only one API container, an in-memory JavaScript object could count requests.

With multiple API containers, each container has its own memory. If each replica counted locally, a client could send requests through different replicas and exceed the intended global limit.

Redis gives all API replicas one shared counter store.

### What the route does

`/api/v1/rate-limited` uses a fixed one-minute window:

```text
1. Determine the current UTC minute.
2. Build a Redis key from client IP plus minute.
3. Increment the counter for that key.
4. Set the key to expire shortly after the minute.
5. Return success until the limit is exceeded.
6. Return HTTP 429 after the limit is exceeded.
```

The default limit is:

```text
RATE_LIMIT_PER_MINUTE=60
```

### Run the rate-limit test

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/rate-limited 10 100
```

This sends more requests than the route allows. You should expect many 429 responses.

Inspect one response manually:

```bash
curl -i http://localhost:8080/api/v1/rate-limited
```

Look for headers:

- `X-RateLimit-Limit`: the configured limit;
- `X-RateLimit-Remaining`: how many requests remain in the current window;
- `Retry-After`: how many seconds to wait after being limited.

### How to interpret this lab

For this lab, 429 responses are not a load-test failure. They are the expected business behavior.

Transport errors and timeouts are different. They mean requests failed at the network or client level before receiving a normal HTTP response.

The limiter is keyed by client IP as seen by HAProxy and Fastify. In classrooms, several students may share one public IP because of NAT. That is one reason production systems often combine IP, API key, user ID, account ID, or route-specific limits.

This workshop does not use Auth0 or any identity provider. A production system might rate-limit by authenticated user or account, but authentication is outside the scope of this local, no-account workshop.

### Checkpoint questions

- Did the status code counts include 429?
- Why is a shared store required when there are multiple API replicas?
- What weakness does a fixed one-minute window have?
- What would change if you rate-limited by user ID instead of IP?

## Lab 6: Queue and worker

### What you are learning

This lab moves work out of the request path.

Synchronous work happens before the API response is sent. The client waits for it.

Asynchronous work is accepted now and processed later. The API can respond quickly with a job ID, while a worker processes the job in the background.

### Why queues exist

Queues are useful when work is:

- slow;
- bursty;
- retryable;
- not required before responding to the client;
- better handled by a separate worker pool.

Examples include sending emails, generating reports, resizing images, charging invoices, importing files, or calling slow third-party APIs.

This workshop does not actually send emails or generate reports. The worker sleeps for a short time to simulate background work.

### What Redis Streams do here

Redis Streams store ordered messages. The API adds a job message to a stream. The worker reads from the stream, marks the job as processing, does the work, marks the job completed, and acknowledges the stream message.

This gives the workshop a simple local queue without requiring RabbitMQ, Kafka, AWS SQS, or any paid service.

### Submit a job

```bash
curl -i -X POST http://localhost:8080/api/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"generate-report","payload":{"student":"demo"}}'
```

What the command means:

- `-X POST` sends an HTTP POST request.
- `-H 'content-type: application/json'` tells the API the body is JSON.
- `-d ...` sends the JSON request body.

The API should return HTTP 202. HTTP 202 means "accepted." The work has been accepted, but may not be complete yet.

Copy the returned `jobId`.

### Poll job status

Use the returned job ID:

```bash
JOB_ID='paste-the-returned-job-id-here'
curl "http://localhost:8080/api/v1/jobs/$JOB_ID"
```

Possible statuses:

- `queued`: the job has been accepted but not started;
- `processing`: a worker is working on it;
- `completed`: the worker finished it.

### Demonstrate queued work

Stop the worker:

```bash
docker compose stop worker
```

Submit another job:

```bash
curl -i -X POST http://localhost:8080/api/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"demo-work","payload":{"student":"queued-demo"}}'
```

Poll it. It should remain `queued` because no worker is running.

Start the worker again:

```bash
docker compose start worker
```

Watch worker logs:

```bash
docker compose logs -f worker
```

Press `Ctrl+C` to stop following logs. This does not stop the worker container; it only exits the log view.

### Instructor crash-recovery demo

This part is optional for students and useful for instructors.

Set a longer worker delay in `.env`:

```text
WORKER_DELAY_MS=5000
```

Recreate the worker:

```bash
docker compose up -d --force-recreate worker
```

Submit a job and wait until it is `processing`. Then kill the worker process abruptly:

```bash
docker compose kill -s SIGKILL worker
```

Start the worker again:

```bash
docker compose start worker
```

After the reclaim timeout plus work time, the pending job should finish. Restore:

```text
WORKER_DELAY_MS=250
```

Then recreate the worker:

```bash
docker compose up -d --force-recreate worker
```

### Reliability interpretation

This queue demonstrates useful ideas, but it is not a complete production queue.

Good news:

- queued jobs are stored in Redis;
- the worker can resume queued work;
- unacknowledged stream messages can be reclaimed;
- completed job status expires after an hour so Redis does not grow forever from completed statuses.

Limits:

- delivery is at least once, not exactly once;
- a job handler with external side effects must be idempotent;
- a host crash can still lose recent writes;
- this is one local Redis instance, not replicated durable infrastructure;
- the demo has no admission control for an infinite backlog.

Idempotent means the same operation can safely run more than once. For example, "set invoice 123 to paid" can be made idempotent; "charge this card again" is dangerous unless protected by an idempotency key.

### Checkpoint questions

- Why did the API return before the work was complete?
- What happened when the worker was stopped?
- What failures can this design recover from?
- What failures would need stronger production infrastructure?

## Lab 7: Observability with Prometheus and Grafana

### What you are learning

This lab teaches observability.

Observability means collecting enough signals to understand what the system is doing. In this workshop, the API exposes metrics, Prometheus collects them, and Grafana displays them.

### Metrics endpoint

The API exposes metrics at:

```bash
curl http://localhost:8080/metrics
```

This endpoint returns text in Prometheus format.

Important metric names:

| Metric | Meaning |
| --- | --- |
| `workshop_http_requests_total` | Count of HTTP requests by route, method, and status. |
| `workshop_http_request_duration_seconds` | Histogram of request latency. |
| `workshop_redis_cache_hits_total` | Count of cache hits. |
| `workshop_redis_cache_misses_total` | Count of cache misses. |
| `workshop_jobs_enqueued_total` | Count of accepted background jobs. |
| `workshop_db_pool_total` | Open database connections in the pool. |
| `workshop_db_pool_idle` | Idle database connections in the pool. |
| `workshop_db_pool_waiting` | Requests waiting for a database connection. |

### Prometheus

Open:

```text
http://localhost:9090
```

Prometheus scrapes metrics from API replicas. Scrape means Prometheus periodically sends an HTTP request to `/metrics` and stores the values it receives.

Try these queries:

```promql
rate(workshop_http_requests_total[1m])
```

This shows per-second request rate calculated from a counter over the last minute.

```promql
sum(rate(workshop_http_requests_total{route!~"/health|/ready|/metrics"}[1m]))
```

This estimates total API request rate while excluding health and metrics traffic.

```promql
histogram_quantile(0.99, sum by (le, route) (rate(workshop_http_request_duration_seconds_bucket[1m])))
```

This estimates p99 latency by route.

```promql
workshop_db_pool_waiting
```

This shows database pool contention.

```promql
workshop_redis_cache_hits_total
workshop_redis_cache_misses_total
```

These show cache behavior.

### Target health

In Prometheus, open:

```text
Status -> Target health
```

With one API replica, you should see one healthy `workshop-api` target. After scaling to three replicas, try:

```promql
count(up{job="workshop-api"} == 1)
```

The result should be `3`.

If you call `/metrics` through HAProxy, you only see the replica that handled that one request. Prometheus discovers and scrapes replicas separately, which is why it can collect metrics from all of them.

### Grafana

Open:

```text
http://localhost:3001/d/workshop
```

Grafana reads from Prometheus and displays the workshop dashboard. It is configured as anonymous read-only, so no login is required.

Keep traffic flowing for at least one minute before judging rate graphs. Queries such as `rate(...[1m])` need data over time.

### How to choose useful alerts

A good alert points to customer pain or an urgent risk. Examples:

- high 5xx error rate;
- p99 latency above the service target;
- API replicas down;
- database pool waiting above zero for a sustained period;
- queue backlog growing for a sustained period.

This workshop dashboard is intentionally small. Production observability would also add database exporters, Redis exporters, tracing, structured logs, and service-level objectives.

### Checkpoint questions

- Which route had the highest p99 latency?
- Did Prometheus see all API replicas?
- Did Grafana show cache hits after Lab 4?
- Which metric would you alert on first for a customer-facing API?

## Lab 8: The 1M RPS capacity model

### What you are learning

This lab turns local measurements into a model.

A model is a structured estimate based on assumptions. It is not proof. It is useful when it clearly states:

- what was measured;
- what was assumed;
- what formula was used;
- what constraints remain untested.

### The honest sentence

Use this sentence pattern:

```text
We measured X RPS locally at Y p99 latency and Z error rate. Using those measurements and the assumptions below, we modeled what a 1,000,000 RPS architecture might require.
```

Do not write:

```text
We proved 1M RPS on a laptop.
```

That would be false.

### Choose a sustainable local result

Pick one single-container result that met a clear quality target. For example:

```text
Route: /api/v1/static
API replicas: 1
Measured rate R: 4,000 RPS
p99 latency target: below 100 ms
Transport errors: 0
5xx errors: 0
```

Use your actual number, not this example.

Do not take an overloaded three-replica result, divide it by three, and call that independent single-server capacity. Measure one container directly.

### API replica estimate

Use:

```text
T = 1,000,000 requests/s target
R = measured sustainable requests/s per API container
f = efficiency/headroom factor between 0 and 1

API replicas = ceil(T / (R x f))
```

`f` accounts for real-world overhead such as imperfect load balancing, deployments, noisy neighbors, uneven traffic, failures, and headroom. A model with `f=1.0` assumes perfect efficiency and no safety margin.

Try sensitivity cases:

```text
Low headroom:    f = 0.80
Medium headroom: f = 0.60
High headroom:   f = 0.40
```

### Database and cache estimate

Define:

```text
r = fraction of requests that need a record read
h = cache hit ratio
```

Then:

```text
Database reads/s = T x r x (1 - h)
Cache GET/s = T x r
Cache SET/s is approximately T x r x (1 - h)
```

Try at least three cache hit ratios:

```text
h = 0.00
h = 0.50
h = 0.99
```

This shows why cache hit rate matters. At 1M RPS, even a small miss percentage can still be a large number of database reads.

Example with `T=1,000,000`, `r=0.80`, and `h=0.99`:

```text
Database reads/s = 1,000,000 x 0.80 x (1 - 0.99)
Database reads/s = 8,000
```

A 99% cache hit rate sounds almost perfect, but this example still sends 8,000 reads per second to the database.

### Queue and worker estimate

Define:

```text
q = fraction of requests that create a job
d = seconds of worker time per job
u = target worker utilization between 0 and 1
```

Then:

```text
Workers needed = ceil(T x q x d / u)
```

Example:

```text
T = 1,000,000 requests/s
q = 0.01
d = 0.25 seconds/job
u = 0.70

Workers needed = ceil(1,000,000 x 0.01 x 0.25 / 0.70)
Workers needed = 3,572
```

This is why asynchronous work can become its own scaling problem.

### Network estimate

Define:

```text
b = average response body bytes
```

Then:

```text
Network bytes/s = T x b
Network bits/s = Network bytes/s x 8
```

At 1M RPS:

```text
200-byte responses  -> 200 MB/s  -> 1.6 Gbit/s
30 KB responses     -> 30 GB/s   -> 240 Gbit/s
```

These are decimal units and only count response body size. HTTP headers, TCP overhead, TLS overhead, retries, internal service calls, metrics traffic, and load balancer hops add more.

Response size matters. A tiny JSON response and a large JSON response can have the same RPS but completely different network costs.

### Load generator estimate

At 1M RPS, the load generators become a distributed system too.

One laptop running AutoCannon cannot safely prove a 1M RPS service. A real test would need multiple load generators, enough network bandwidth, careful regional placement, synchronized test plans, and monitoring for the load generators themselves.

If the load generator is maxed out, the service may look slower than it really is. If the service is maxed out, the load generator may report errors. You need metrics on both sides.

### Required final write-up

Write one page with these sections:

```text
Measured locally
- route:
- API replicas:
- duration:
- connections:
- RPS:
- average latency:
- p99 latency:
- error rate:
- machine and Docker resources:

Assumptions
- target traffic:
- response size:
- efficiency/headroom factor:
- record-read fraction:
- cache hit ratio:
- job creation fraction:
- worker seconds per job:

Model
- API replicas:
- database reads/s:
- Redis GET/s:
- Redis SET/s:
- worker count:
- network bytes/s and bits/s:

Risks and validation needed
- database capacity:
- Redis capacity:
- gateway capacity:
- load-generator capacity:
- multi-region or network limits:
- failure and deployment headroom:
```

### Checkpoint questions

- Which values did you measure?
- Which values did you assume?
- Which assumption changes the model the most?
- What would you need to test before believing the model in production?

## Useful reset and cleanup commands

Stop containers but keep data volumes:

```bash
docker compose down
```

Start again:

```bash
docker compose up --build -d --wait
```

Reset local database, Redis, and Grafana volumes:

```bash
docker compose down -v
docker compose up --build -d --wait
```

Use `down -v` carefully. It deletes local workshop data volumes.

View logs:

```bash
docker compose logs api
docker compose logs worker
docker compose logs gateway
docker compose logs db
docker compose logs redis
```

Run the smoke test:

```bash
./scripts/smoke-test.sh
```

On Windows Git Bash, the same command should work. If shell scripts are blocked in your terminal, use:

```bash
docker compose exec -T api node scripts/smoke-test.js
```

## Common beginner problems

### Docker Desktop is not running

Symptom:

```text
Cannot connect to the Docker daemon
```

Fix: start Docker Desktop and wait until it says Docker is running.

### Port already in use

Symptom:

```text
port is already allocated
```

Fix: another process is using `8080`, `9090`, or `3001`. Stop that process or change the port mapping in `docker-compose.yml`.

### Containers are unhealthy

Check:

```bash
docker compose ps
docker compose logs api
docker compose logs db
docker compose logs redis
```

Common causes include not enough Docker memory, old containers from a previous run, or a service still starting.

### Load test cannot reach `localhost`

Inside Docker, use:

```text
http://gateway:8080
```

From your laptop terminal, use:

```text
http://localhost:8080
```

This difference is one of the most common beginner mistakes.

### Rate limit lab keeps returning 429

Wait until the next UTC minute. The limiter uses fixed one-minute buckets.

You can also restart Redis during a local lab, but that clears other Redis data too:

```bash
docker compose restart redis
```

### Grafana graphs look empty

Generate traffic for at least one minute, then refresh Grafana.

Many dashboard panels use one-minute Prometheus rates. They need data over time.

### PostgreSQL changes do not appear after editing init SQL

PostgreSQL initialization scripts run only when the database volume is created. To rerun initialization from scratch:

```bash
docker compose down -v
docker compose up --build -d --wait
```

This deletes local workshop volumes.

## Final instructor checklist

Before teaching, run:

```bash
docker compose config
docker compose up --build -d --wait
./scripts/smoke-test.sh
docker compose run --rm loadtest http://gateway:8080/api/v1/static 10 25
docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 10 25
docker compose run --rm loadtest http://gateway:8080/api/v1/cached-records/42 10 25
docker compose up --build -d --scale api=3
docker compose ps
docker compose run --rm loadtest http://gateway:8080/api/v1/static 10 25
docker compose down
```

Confirm:

- Docker Desktop has enough CPU and memory assigned;
- no cloud credentials are needed;
- no paid service is used;
- Grafana opens at `http://localhost:3001/d/workshop`;
- Prometheus opens at `http://localhost:9090`;
- the API opens through HAProxy at `http://localhost:8080`;
- students understand that 1M RPS is modeled, not proven locally.
