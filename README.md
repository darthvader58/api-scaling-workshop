# API Scaling Workshop

A fully local, Docker-first workshop for learning how an API evolves from a single fast route into a system with database access, Redis caching, rate limiting, horizontal scaling, connection pooling, asynchronous work, and observability.

This repository is intentionally designed so that nobody needs AWS, a paid service, or a cloud account.

Reference video: [Let’s Handle 1 Million Requests per Second, It’s Scarier Than You Think!](https://www.youtube.com/watch?v=W4EwfEU8CGA)

The workshop follows its progression but replaces paid cloud infrastructure with local Docker services and treats 1M RPS as a capacity-model exercise.

## What students will learn

1. Establish a baseline with a tiny Fastify API.
2. Measure throughput and latency with AutoCannon.
3. See how PostgreSQL becomes a bottleneck.
4. Tune and observe a PostgreSQL connection pool.
5. Add Redis as a cache for hot reads.
6. Add a Redis-backed rate limiter.
7. Add a Redis-backed asynchronous job queue and worker.
8. Run multiple API containers behind HAProxy.
9. Inspect metrics in Prometheus and Grafana.
10. Explain why 1 million requests/second is a system-capacity problem, not a single-code-line optimization.

## Prerequisites

For beginners, Docker is the required path. Without Docker, students would need to install and configure Node.js, PostgreSQL, Redis, HAProxy, Prometheus, Grafana, and the load tester separately. The native path is documented only as an advanced fallback.

Students should install Git and Docker Desktop before the workshop:

- Docker Desktop: https://www.docker.com/products/docker-desktop/
- Git: https://git-scm.com/downloads

See the step-by-step beginner guide in `docs/SETUP.md`.

Verify the setup:

```bash
docker --version
docker compose version
git --version
```

No cloud account or payment method is needed.

## Start the lab

```bash
git clone <YOUR_REPOSITORY_URL>
cd api-scaling-workshop
docker compose up --build -d
curl http://localhost:8080/health
```

Expected response:

```json
{"status":"ok"}
```

Open the local tools:

- API gateway: http://localhost:8080
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001

## Run a local benchmark

The load tester also runs inside Docker:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/static 15 100
```

Arguments are target URL, duration in seconds, and concurrent connections.

For a route that talks to PostgreSQL:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 15 100
```

For the Redis-backed route:

```bash
docker compose run --rm loadtest http://gateway:8080/api/v1/cached-records/42 15 100
```

## Horizontal scaling experiment

Start three API containers behind the gateway:

```bash
docker compose up --build -d --scale api=3
```

Confirm the containers:

```bash
docker compose ps
```

Then repeat the benchmark. The goal is to compare throughput, latency, and CPU usage, not to claim that three laptop containers equal three production servers.

## Queue experiment

Submit a job:

```bash
curl -X POST http://localhost:8080/api/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"send-report","payload":{"student":"demo"}}'
```

The API returns a `jobId` and `202 Accepted`. Check the job using the returned ID:

```bash
curl http://localhost:8080/api/v1/jobs/<JOB_ID>
```

Watch the worker:

```bash
docker compose logs -f worker
```

## Stop and reset

```bash
docker compose down
```

To delete local database, Redis, and Grafana data too:

```bash
docker compose down -v
```

## Important measurement note

A laptop is not a valid environment for proving 1 million RPS. Students should report their measured local result, identify the bottleneck, and use a capacity model to explain how many independent workers, cores, cache capacity, database capacity, and load generators a production design would need.

Run the automated smoke test after startup:

```bash
./scripts/smoke-test.sh
```

See:

- `docs/SETUP.md`
- `docs/WORKSHOP_PLAN.md`
- `docs/LABS.md`
- `presentation/workshop-deck.md`
