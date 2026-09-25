# Local audit and repair report

Date: 2026-09-25. Baseline commit: `ee54691`.

The workspace was already a clean clone of `https://github.com/darthvader58/api-scaling-workshop.git`; it was inspected in place rather than creating a nested clone. No commits, pushes, releases, or GitHub settings changes were made.

## Current health

The Docker workshop now passes startup, SQL/cache/rate-limit/job smoke checks, three-replica routing, per-replica Prometheus discovery, Grafana datasource/dashboard API checks, worker crash recovery, and Redis restart recovery. A separate project with empty volumes also started successfully and seeded exactly 10,000 records.

The original Compose YAML was syntactically valid. Its service names, explicit container load-test URLs, and Grafana-to-Prometheus URL were correct. All required nested files listed in the review request were present and tracked. The serious issues were runtime behavior and incomplete teaching/validation paths, not missing original files.

The stack remains local and retains Node.js/Fastify/PostgreSQL/Redis/HAProxy/Prometheus/Grafana/AutoCannon. Students need Git and Docker Desktop only. No AWS, cloud credentials, paid service, account creation, or payment method was introduced.

## Findings by severity

Severity reflects impact on the workshop, not a formal security rating.

### High — fixed

1. **Job submission failed for object payloads.** `hSet` received a JavaScript object as a hash field value; the installed node-redis client reports `Invalid argument type`. Payloads now serialize to JSON on write and deserialize on read; body validation rejects wrong shapes.
2. **Queue delivery could lose work.** `BRPOP` removed the only copy before work completed, so a worker crash stranded a job. Redis Streams now retain unacknowledged deliveries and reclaim them after 30 seconds. Completion/status retention/acknowledgment/removal execute in one transaction. Simulated work is bounded below the reclaim interval, and graceful shutdown finishes the current job.
3. **Queue/status creation and retention were inconsistent.** Separate hash, expiry, and enqueue commands could leave partial state, and the status expired after an hour even if the worker had not processed it. Submission is transactional; pending status has no TTL, and the one-hour TTL starts on completion. Malformed stream messages are retained in a failure stream for inspection.
4. **Benchmarking silently undid horizontal scaling.** Reproduced on Compose v5.1.4: `run --rm loadtest` traversed its gateway/API dependencies and removed API replicas 2 and 3. This caused 503s/timeouts and invalidated the comparison. The load-test service no longer starts dependencies; the stack must already be running. The exact requested benchmark command now preserves three replicas.
5. **Rate limiting grouped requests under HAProxy's address.** HAProxy now replaces incoming `X-Forwarded-For`; the API opts into trusting private-network peers only in Compose. Tests verify one quota across three replicas, independent client IPs, and resistance to caller-supplied forwarding headers. The API port remains unpublished.
6. **Prometheus had one unstable scrape identity for many replicas.** A static `api:3000` target cannot represent independent process counters correctly. DNS discovery now creates a target per API address; three healthy targets were verified.
7. **Dependency errors could crash processes without useful handling.** Added Redis error listeners in API/worker and the PostgreSQL pool's idle-client error listener. API Redis commands do not wait in an offline queue. Dependency outage/readiness and subsequent Redis/queue recovery were tested.

### Medium — fixed

8. **Startup health did not establish readiness.** The API had only unconditional `/health`; the gateway could start before useful service readiness. Added `/ready`, API/gateway health checks, and healthy API dependencies. PostgreSQL health now uses TCP so its temporary initialization socket server does not satisfy the check prematurely. Startup verifies the records table, and beginner startup uses `--wait`.
9. **Rate counter increment/expiry was not atomic.** A failure between `INCR` and `EXPIRE` left a key without TTL. They now run in a transaction. The fixed-minute window, boundary bursts, NAT sharing, and expected 429s are documented.
10. **Grafana was not a usable beginner observability path.** Anonymous Viewer access and a datasource were present, but no dashboard or actionable UI steps. Added a provisioned six-panel dashboard, stable datasource UID, pool gauges, per-replica target checks, and aggregation/p99 queries. The existing internal datasource URL was retained.
11. **Smoke checks missed important failures and could not execute as documented.** The shell file was mode 0644 and omitted queue/rate-limit behavior and startup retries. It is now executable, invokes the API container's Node runtime, and checks readiness, record validation, actual Redis cache hits, 429s, metrics, and completed jobs. Added a Docker failure/recovery regression script for instructors.
12. **Benchmark results could disguise failure as throughput.** Added success/non-2xx/status counts, bytes/sec, argument validation, and failure exit status for transport errors, timeouts, no responses, or 5xx. Intentional 429s remain visible and do not fail the rate-limit lab. The no-argument container target now points at `gateway`, not its own localhost.
13. **Invalid record IDs reached PostgreSQL and produced server errors.** Added integer/range validation; malformed, negative, and oversized IDs return 400, while absent valid IDs return 404. Invalid pool/rate settings fail early.
14. **Public host bindings exposed anonymous local tools.** Gateway, Prometheus, and Grafana ports now bind to `127.0.0.1`. This also makes the private-network proxy trust assumption explicit; it is not an internet deployment recipe.
15. **The cache reset lab deleted unrelated state.** `FLUSHALL` removed rate counters and queued jobs too. The lab now deletes only `record:42`, demonstrates sequential cold/warm reads, and uses `SCAN` for inspection.
16. **Per-request logging and unbounded route labels undermined measurements.** Routine API/gateway request logging is suppressed while errors/lifecycle logs remain. Unmatched paths use one metrics label instead of creating a series for every arbitrary URL.
17. **Builds did not strictly honor the lockfile.** Both Dockerfiles now use `npm ci --omit=dev`; no dependency versions were changed. The API image includes the smoke script.
18. **Beginner commands/configuration were misleading.** Replaced clone URL placeholders, removed the suggestion that the public clone needs authentication, standardized Windows examples on Git Bash, provided a shell-independent Docker smoke command, and forced LF for shell scripts. `.env.example` now lists settings actually substituted by Compose. Setup clarifies first-run downloads, Desktop requirements, memory, persistence/reset, host/container DNS, and service responsibilities.
19. **Lab/model instructions encouraged uncontrolled comparisons.** Reset to one replica for pool experiments; document connections per replica, environment/status recording, repetitions, cold/warm cache, timer resolution, load-generator contention, and why the indexed SQL route may not saturate PostgreSQL. Added explicit capacity/headroom/cache/worker/network formulas, bits/sec, overhead, sensitivity cases, and measured-versus-assumed labels. Existing warnings against claiming laptop 1M RPS were retained and strengthened.

### Low — fixed

20. **Redundant SQL index.** The primary key already indexes `records.id`; removed the duplicate index from fresh initialization. Existing volumes are not automatically migrated.
21. **Teaching/operations gaps.** Added worker progress logs, a guarded API shutdown deadline, separate liveness/readiness explanations, queue delivery/retention caveats, a concrete instructor preflight, and clearer job polling and worker-stop experiment steps.

### Remaining maintenance findings

22. **Moderate npm advisory chain remains.** `npm audit --json` reports three moderate package entries (`autocannon`, `hyperid`, `uuid`) for one transitive UUID advisory, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). npm proposes downgrading AutoCannon to 2.0.1 as a breaking fix. That downgrade was not applied. Inspection of the installed hyperid shows it uses `crypto.randomUUID` on Node 22, with a `uuid.v4` fallback; the advisory identifies buffer handling in other UUID functions. This limits the demonstrated exposure but does not constitute a complete security audit. Review upstream fixes before future workshops.
23. **Dependency deprecation notices.** npm reports deprecation of `prom-client@15.1.3` and the transitive `uuid@8.3.2`. The working teaching stack was retained rather than introducing an unrelated metrics-library migration.

## Files changed

| File | Reason |
|---|---|
| `.env.example` | Only effective Compose tuning variables; defaults require no setup |
| `.gitattributes` (new) | LF shell scripts on Windows checkouts |
| `Dockerfile` | Lockfile install and container smoke script |
| `loadtest.Dockerfile` | Lockfile install |
| `docker-compose.yml` | Readiness, tuning substitutions, loopback bindings, safe standalone load tester |
| `src/server.js` | Queue serialization/transactions, proxy-aware limiter, validation, error handling, readiness, metrics, shutdown |
| `src/worker.js` | Recoverable Streams queue, acknowledgment, retention, progress logs, shutdown |
| `loadtest/run.js` | Input validation, status/byte reporting, failure signaling |
| `scripts/smoke-test.sh` | Executable wrapper requiring no host Node/curl/parser |
| `scripts/smoke-test.js` (new) | Readiness, SQL/cache/validation/metrics/rate/job smoke checks |
| `scripts/integration-test.js` (new) | Replica, observability, quota/spoof, queue crash, Redis outage checks |
| `db/init/001_schema.sql` | Remove redundant index on fresh initialization |
| `infra/haproxy.cfg` | Sanitized client forwarding, readiness checks, quieter benchmark logs |
| `infra/prometheus/prometheus.yml` | Discover each API replica |
| `infra/grafana/provisioning/datasources/prometheus.yml` | Stable datasource UID |
| `infra/grafana/provisioning/dashboards/workshop.yml` (new) | Provision anonymous-viewable dashboard |
| `infra/grafana/provisioning/dashboards/workshop.json` (new) | Six panels for traffic, p99, cache, pool, accepted jobs, CPU |
| `README.md` | Real clone URL, service map, runnable start/test/queue instructions |
| `docs/SETUP.md` | Git/Desktop/shell guidance, readiness, effective settings, troubleshooting/reset |
| `docs/LABS.md` | Controlled lab steps, safe reset, observability, queue limitations, capacity worksheet |
| `docs/WORKSHOP_PLAN.md` | Instructor preflight, honest database/model guidance |
| `presentation/workshop-deck.md` | Matching URLs, queue/rate explanations and capacity/network formulas |
| `docs/REVIEW_REPORT.md` (new) | This audit and validation record |

`package.json`, `package-lock.json`, `.dockerignore`, `.gitignore`, and `CONTRIBUTING.md` were inspected and left unchanged.

## Validation commands and outcomes

Environment: macOS host, Docker Desktop Linux/aarch64 engine 29.4.3, Compose v5.1.4, six Docker CPUs, approximately 11.7 GiB Docker memory. Host Node v24.7.0; application images use Node 22 Alpine. Docker/localhost access needed sandbox escalation and worked after approval.

Passed:

- `docker --version`, `docker compose version`, `docker info`.
- `docker compose config` and `docker compose --profile loadtest config --quiet`.
- `npm ci` (with the advisory/deprecation findings above).
- `docker compose up --build -d`, readiness-waiting startup, and `docker compose ps`.
- `./scripts/smoke-test.sh`, including after three-replica and failure/recovery checks.
- Host `curl` for `/health`, `/api/v1/static`, `/api/v1/records/42`, `/api/v1/cached-records/42`, `/metrics`.
- JSON job POST with nested payload, polling its returned status URL until completed.
- `docker compose run --rm loadtest http://gateway:8080/api/v1/static 10 25`.
- `docker compose run --rm loadtest http://gateway:8080/api/v1/records/42 10 25`.
- `docker compose run --rm loadtest http://gateway:8080/api/v1/cached-records/42 10 25`.
- `docker compose up --build -d --scale api=3`, repeated static benchmark, and confirmation that three replicas remain afterward.
- `node scripts/integration-test.js`: all checks passed, including SIGKILL during processing and Redis stop/start.
- `docker compose exec -T gateway haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg`.
- `docker compose exec -T prometheus promtool check config /etc/prometheus/prometheus.yml`.
- Grafana dashboard retrieval and datasource health through its anonymous HTTP API.
- Fresh-volume startup under isolated project `api-scaling-audit-20260925`, Docker smoke check, and SQL count of 10,000 rows.
- `node --check` for server, worker, load tester, and both new JavaScript test scripts; `sh -n scripts/smoke-test.sh`; `git diff --check`.
- CPU and rate-limit routes benchmarked at `5 25` in the isolated fresh project. CPU returned only 200s; rate limiting returned 60 successful responses and 164,514 HTTP 429s, with zero errors/timeouts.
- `docker compose down` completed; the separate audit project was removed with its own test-only volumes using `docker compose -p api-scaling-audit-20260925 down -v`. Final `docker compose ps -a` was empty. Default workshop data volumes were retained.
- Load-test duration `0` correctly rejected with a usage message and exit code 1.

An intermediate scaled benchmark failed with 503s/timeouts because Compose removed two replicas. That failure led to finding 4; the final repeated command passed. Initial sandbox-denied Docker/localhost calls were retried with appropriate access and are not unresolved environment blockers. `npm audit` completed with exit code 1 for the retained advisory, not a clean security result.

Illustrative single-run validation measurements (25 connections, requested 10 seconds; AutoCannon reported 11.01 seconds elapsed):

| Route | API replicas | Average RPS | p99 ms | Non-2xx / errors / timeouts |
|---|---:|---:|---:|---|
| static | 1 | 51,425 | 1 | 0 / 0 / 0 |
| PostgreSQL record 42 | 1 | 26,359 | 1 | 0 / 0 / 0 |
| cached record 42 | 1 | 56,790 | 0 | 0 / 0 / 0 |
| static after scaling fix | 3 | 76,735 | 1 | 0 / 0 / 0 |

These are short functional validation samples, not repeated controlled capacity measurements or production sizing claims. `0 ms` reflects reporting resolution, not zero latency. No 1M RPS claim is made.

## Not run / limits of validation

- No requested core validation command remains blocked by the environment. A second `git clone` was unnecessary because the requested repository was already checked out cleanly.
- Windows and Linux desktop installation flows were reviewed but not executed; only the available macOS/Docker Desktop host was tested.
- Grafana provisioning and datasource/dashboard API behavior were tested, but browser screenshot/layout QA was not performed.
- Every documented 15-second/100-connection variant and pool-size sweep was not exhaustively benchmarked; the requested 10-second/25-connection routes and targeted regressions were exercised.
- Native setup, image vulnerability scanning, prolonged saturation, host-power-loss durability, and production/distributed capacity were not tested. Native setup stays an optional advanced description.

## Remaining design risks

- Queue delivery is at least once. External side effects require idempotency; long work requires leases/heartbeats. The 30-second reclaim interval and maximum 5-second simulated delay are teaching constraints, not a general-purpose queue scheduler.
- Redis is one local instance with AOF and no replication. Host failure can lose recent writes. Backlogs and the malformed-message stream have no admission/retention limits; this repository is not a production platform.
- API proxy trust assumes the private Compose network is trusted and the gateway is the only published API entry point. Do not expose API ports or these anonymous tools publicly. NAT can collapse client identity.
- The shared database/cache, laptop CPU, gateway, and load generator constrain scaling. HAProxy has ten replica slots. DNS/health convergence after recreation can briefly affect traffic; warm up before measuring.
- PostgreSQL initialization edits only apply to empty volumes. Existing data retains its redundant index until deliberately reset/migrated. Normal shutdown retains workshop data; Prometheus history is ephemeral.
- Existing image tags and dependency deprecations require periodic instructor maintenance; npm findings are recorded above. Docker Desktop's free educational use is subject to [Docker's license terms](https://docs.docker.com/subscription-billing/desktop-license/).

## Instructor preflight

1. Open Docker Desktop; verify Git, Docker, Compose, engine access, free ports, disk space, and memory.
2. Use defaults (pool 10, rate 60/minute, worker delay 250 ms); inspect/remove unintended environment overrides.
3. Run Compose config, `up --build -d --wait`, and the smoke test.
4. Benchmark static/SQL/cache at `10 25`; record status counts, latency, throughput, and resource allocation.
5. Scale to three, repeat the benchmark, and verify three replicas remain; check three Prometheus targets.
6. Open `/d/workshop` in Grafana, generate traffic for a minute, and verify useful graphs.
7. Rehearse rate limiting and queue stop/restart/crash recovery. Optionally run the host-Node instructor integration script.
8. Restore one replica and default settings, run `docker compose down`, and bring backup screenshots/results. Use `down -v` only when workshop data may be deleted.

## Topic coverage

| Required topic | Repository support |
|---|---|
| Basic API | `/api/v1/static`, Lab 1 |
| Load testing | Docker AutoCannon, latency/status/byte reporting |
| PostgreSQL bottleneck | Seeded records route, Lab 3, explicit measurement caveat |
| Connection pooling | Configurable per-process pool and gauges, Lab 3 |
| Redis caching | TTL cache with hit/miss counters, Lab 4 |
| Redis-backed rate limiting | Shared atomic fixed-minute counters, Lab 5 |
| Horizontal scaling | HAProxy plus `--scale api=3`, Lab 2 |
| Queue/asynchronous work | Redis Streams, worker, job status/recovery, Lab 6 |
| Prometheus/Grafana | Per-replica scraping and provisioned dashboard, Lab 7 |
| Conceptual 1M RPS modeling | Assumption-based worksheet, sensitivity/network/worker budgets, Lab 8 |

All ten topics remain supported. Students measure local behavior and build a defensible extrapolation; they are not told their laptops demonstrate 1M RPS.

Implementation references checked during the audit include [node-redis transactions/events](https://github.com/redis/node-redis), [Fastify proxy trust](https://github.com/fastify/fastify/blob/main/docs/Reference/Server.md), [Compose readiness](https://github.com/docker/compose/blob/main/docs/reference/compose_up.md), [Prometheus DNS discovery](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#dns_sd_config), and [Redis pending-message reclamation](https://redis.io/docs/latest/commands/xautoclaim/). Installed node-redis 4 APIs were also checked directly; current documentation includes newer major-version method names that were not blindly substituted.
