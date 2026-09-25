---
title: Scaling an API to 1 Million Requests per Second
subtitle: A local, Docker-first workshop
paginate: true
marp: true
---

# Scaling an API to 1 Million Requests per Second

## Measure, find the bottleneck, change one thing, measure again

**Workshop repository:** `api-scaling-workshop`

No cloud account. No paid services. Everyone runs the same stack locally.

---

# The important disclaimer

A student laptop will not prove 1M RPS.

The learning goal is to:

- measure a real service;
- identify bottlenecks;
- understand trade-offs;
- build a capacity model for 1M RPS.

Measured facts and extrapolated assumptions must be labeled separately.

---

# The learning loop

```text
baseline
   ↓
measure
   ↓
find the bottleneck
   ↓
change one layer
   ↓
measure again
```

Scaling is not “add Redis everywhere.”

Scaling is controlled experimentation.

---

# Local architecture

```text
AutoCannon
    │
    ▼
 HAProxy :8080
    │
    ├── API container 1
    ├── API container 2
    └── API container 3
          │       │
          ▼       ▼
     PostgreSQL  Redis
                    │
                    ▼
                  Worker

Prometheus + Grafana observe the system
```

---

# Start the workshop

```bash
git clone https://github.com/darthvader58/api-scaling-workshop.git
cd api-scaling-workshop
docker compose up --build -d --wait
curl http://localhost:8080/health
```

Tools:

- API: `http://localhost:8080`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001/d/workshop`

---

# Stage 1: The basic API

Route:

```text
GET /api/v1/static
```

It does not use PostgreSQL or Redis.

Questions:

- How many requests/second can one local container handle?
- What is average latency?
- What is p99 latency?
- What saturates first: CPU, client, network, or server?

---

# Stage 2: Load testing

```bash
docker compose run --rm loadtest \
  http://gateway:8080/api/v1/static 15 100
```

Record:

- throughput;
- latency;
- p99 latency;
- errors;
- timeouts.

A benchmark without a recorded environment is only a number.

---

# Stage 3: CPU and process scaling

Route:

```text
GET /api/v1/cpu
```

Run one API container, then:

```bash
docker compose up --build -d --scale api=3
```

Horizontal scaling helps when work is independent. It does not remove a shared database or network bottleneck.

---

# Stage 4: The database bottleneck

Route:

```text
GET /api/v1/records/42
```

Now every request involves:

1. a network hop;
2. a connection from the pool;
3. query execution;
4. a response from PostgreSQL.

The fastest application code cannot outrun a saturated dependency.

---

# Stage 5: Connection pooling

`pg.Pool` limits how many database connections the API opens.

Try pool sizes:

```text
2 → 10 → 20
```

A larger pool can increase concurrency, but it can also overload PostgreSQL and increase contention.

Find the point where more connections stop helping.

---

# Stage 6: Redis caching

Route:

```text
GET /api/v1/cached-records/42
```

Flow:

```text
Redis hit → return quickly
Redis miss → query PostgreSQL → set TTL → return
```

Discuss:

- cache hit rate;
- TTLs;
- invalidation;
- stale data;
- hot keys;
- cache stampedes.

---

# Stage 7: Rate limiting

Route:

```text
GET /api/v1/rate-limited
```

Redis stores an atomic, shared fixed-minute counter across API containers.
HAProxy forwards the client IP; NAT users may share a quota.

```text
allowed request → continue
excess request  → HTTP 429
```

Rate limiting protects both customers and downstream dependencies.

---

# Stage 8: Queues and asynchronous work

Submit work:

```text
POST /api/v1/jobs → 202 Accepted
```

The API does not make the client wait for slow work.

```text
API → Redis Stream → worker → acknowledge + job status
```

Production questions:

- at-least-once delivery and crash recovery;
- retries;
- idempotency;
- dead-letter queues;
- backpressure;
- queue depth;
- eventual consistency.

---

# Stage 9: Observability

Metrics endpoint:

```text
GET /metrics
```

Prometheus measures. Grafana visualizes.

Useful signals:

- request rate;
- latency and p99;
- errors and 429s;
- cache hits and misses;
- accepted jobs (not a queue-depth gauge);
- process CPU and memory.

If we cannot see the bottleneck, we are guessing.

---

# The 1M RPS capacity model

```text
Target: 1,000,000 requests/second
Measured rate per API container: ______
Assumed production efficiency: ______%
Required API containers: ______
Cache hit rate: ______%
Database requests/second: ______
Redis requests/second: ______
Average response bytes: ______
Network bytes/second: ______
```

Replicas = ceil(target / (measured sustainable RPS × assumed efficiency)).
Database reads/s = target × read fraction × (1 − cache hit fraction).

The result is a model, not a local benchmark claim.

---

# Why response size matters

```text
network bytes/second
= requests/second × average response bytes
```

At 1M RPS:

- 200 bytes/request ≈ 200 MB/s;
- 30 KB/request ≈ 30 GB/s (240 Gbit/s).

Decimal units; protocol overhead and internal traffic are additional.

The application may be fast while the network becomes the bottleneck.

---

# Final group challenge

Design a production-shaped architecture for 1M RPS.

Your group must state:

1. API worker count and scaling strategy.
2. Load-balancing strategy.
3. Database and cache responsibilities.
4. Rate-limit key and policy.
5. Queue and worker strategy.
6. Metrics and alerts.
7. One assumption that could make the model wrong.

---

# Takeaways

- Measure before optimizing.
- Scale the bottleneck, not the component you happen to like.
- Redis is useful for hot data and coordination, not as automatic magic.
- Connection pools must be sized with the database in mind.
- Queues protect latency by moving slow work out of the request path.
- Observability turns “it is slow” into a testable hypothesis.
- 1M RPS is a whole-system and capacity-planning problem.
