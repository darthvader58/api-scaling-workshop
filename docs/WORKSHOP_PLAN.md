# Workshop Plan: Scaling an API to 1 Million Requests/Second

## Workshop promise

Students will not magically make a laptop serve 1 million requests/second. They will learn how to measure a system, find the current bottleneck, apply one architectural change, and measure again. The final milestone is a defensible capacity model for 1M RPS.

## Recommended format

**Length:** 4 hours, including a 15-minute break

**Audience:** Developers who know basic HTTP and JavaScript. No prior Redis, PostgreSQL, Docker, or observability experience is assumed.

**Delivery model:** Instructor demo plus individual checkpoints. Everyone runs the same repository locally.

## Before the workshop

Send students this checklist at least two days beforehand:

1. Install Docker Desktop.
2. Install Git.
3. Clone the repository after it is published.
4. Run `docker compose up --build -d`.
5. Confirm `curl http://localhost:8080/health` returns `{"status":"ok"}`.
6. Open Prometheus at `http://localhost:9090` and Grafana at `http://localhost:3001`.

Ask students to bring a laptop with at least 8 GB RAM and 10 GB free disk space. Docker Desktop must be allowed to use enough CPU and memory for PostgreSQL, Redis, HAProxy, Prometheus, Grafana, and the API containers.

## Agenda

| Time | Module | Student outcome |
|---|---|---|
| 00:00-00:15 | Context and safety | Understand that 1M RPS is a capacity-model target, not a laptop promise |
| 00:15-00:35 | Docker setup and repository tour | Everyone has the stack running |
| 00:35-01:00 | Baseline API and load testing | Establish RPS, latency, errors, and CPU baseline |
| 01:00-01:30 | CPU, event loop, and horizontal process scaling | Observe why one process stops scaling linearly |
| 01:30-02:00 | PostgreSQL bottleneck and connection pooling | See storage latency and pool contention |
| 02:00-02:15 | Break | |
| 02:15-02:45 | Redis caching | Compare cold-cache and warm-cache behavior |
| 02:45-03:05 | Rate limiting | Protect the service with a Redis-backed counter |
| 03:05-03:30 | Queueing and asynchronous work | Return 202 quickly and move slow work to a worker |
| 03:30-03:50 | Observability | Use Prometheus/Grafana to explain what changed |
| 03:50-04:00 | 1M RPS capacity model and wrap-up | Present a defensible architecture and assumptions |

## Instructor preparation

Before students arrive:

- Run the full stack on the instructor laptop.
- Run every load-test command in `docs/LABS.md`.
- Prepare one known-good benchmark result, but emphasize that student results will differ.
- Have a backup recording or screenshots of Prometheus/Grafana in case Docker fails.
- Do not use real production credentials, cloud accounts, or paid services.

## Teaching sequence

### 1. Baseline

Start with `/api/v1/static`. Ask students to predict the bottleneck before benchmarking. Measure throughput, average latency, p99 latency, errors, and CPU.

### 2. CPU and horizontal scaling

Use `/api/v1/cpu` to create repeatable CPU work. Compare one API container with three API containers behind HAProxy. Explain that horizontal scaling helps only when the workload is independent and the downstream systems can also handle the added traffic.

### 3. Database bottleneck

Use `/api/v1/records/42`. Compare the simple route and database route. Explain disk, query execution, network hops, locks, and connection limits. Then change `DB_POOL_MAX` and repeat the experiment. Students should look for the point where increasing pool size stops helping.

### 4. Redis caching

Use `/api/v1/cached-records/42`. The first request is a cache miss and subsequent requests are cache hits. Discuss TTLs, invalidation, stale data, hot keys, cache stampedes, and the fact that Redis is not a universal replacement for a durable database.

### 5. Rate limiting

Use `/api/v1/rate-limited`. Run a short high-concurrency test and observe HTTP 429 responses. Discuss per-user keys, distributed counters, burst capacity, fairness, and why rate limiting protects downstream dependencies.

### 6. Asynchronous work

Use `POST /api/v1/jobs`. The API acknowledges quickly and the worker performs delayed work. Discuss queues, retries, idempotency, dead-letter queues, backpressure, and eventual consistency.

### 7. Observability

Use `/metrics` and the Prometheus/Grafana tools. Students should answer: Is the API slow because of CPU, PostgreSQL, Redis, queue depth, or the load generator? Emphasize that scaling without measurement is guessing.

### 8. The 1M RPS model

Have each group fill in:

```text
Target: 1,000,000 requests/second
Measured local rate per API container: ______
Assumed production efficiency: ______%
Estimated API containers: ______
Requests per database read: ______
Cache hit rate: ______%
Estimated database requests/second: ______
Estimated Redis requests/second: ______
Load-generator capacity required: ______
Largest remaining bottleneck: ______
```

Then discuss the network budget:

```text
network bytes/second = requests/second × average response bytes
```

A small response and a 30 KB response lead to radically different systems. The video demonstrates this distinction, and this workshop should make it explicit.

## Assessment / completion criteria

A student completes the workshop when they can:

- show a baseline benchmark;
- explain the PostgreSQL bottleneck;
- demonstrate a Redis cache hit;
- trigger a 429 response;
- submit and observe an asynchronous job;
- scale the API to multiple containers;
- open the metrics endpoint and identify at least one useful metric;
- present a 1M RPS capacity model with assumptions and bottlenecks.

## Troubleshooting

### Docker cannot start

Check Docker Desktop is open, then run `docker compose ps` and `docker compose logs db redis api`.

### Port already in use

Stop the process using port 8080, 9090, or 3001, or change the host-side port in `docker-compose.yml`.

### API is unhealthy

Run `docker compose logs api`. PostgreSQL and Redis may still be starting. Wait 15 seconds and retry.

### Benchmark shows zero or very low throughput

Check that the target is the gateway URL, not a container-only hostname. From the host, use `http://localhost:8080`; from the `loadtest` container, use `http://gateway:8080`.

### Laptop becomes slow

Reduce connections from 100 to 25, reduce Docker Desktop CPU/memory limits, and stop Grafana if necessary. The goal is learning, not exhausting the machine.
