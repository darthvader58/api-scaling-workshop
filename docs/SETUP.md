# Beginner Setup Guide

This workshop is designed for students who have not used Docker, Redis, PostgreSQL, or load-testing tools before.

## Recommended approach

Use Docker Desktop. Students only need to install:

1. Git
2. Docker Desktop

The repository supplies the API, PostgreSQL, Redis, HAProxy, Prometheus, Grafana, worker, and load tester.

Plan for at least 8 GB system RAM and 10 GB free disk space. Internet is needed for the first image/package downloads; no cloud service is used at runtime.

Docker Desktop is free for education under [Docker’s license terms](https://docs.docker.com/subscription-billing/desktop-license/). Install and use it locally without signing in; no payment method is required for this workshop. Institutional/commercial deployments should check their own eligibility.

## Step 1: Install Git

### Windows

Download Git for Windows:

https://git-scm.com/download/win

During installation, the default options are fine.

### macOS

Install Xcode Command Line Tools if macOS asks for them:

```bash
xcode-select --install
```

Or install Git from:

https://git-scm.com/download/mac

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y git
```

## Step 2: Install Docker Desktop

Download Docker Desktop:

https://www.docker.com/products/docker-desktop/

### Windows

- Install Docker Desktop.
- Follow the [Windows requirements and installation guide](https://docs.docker.com/desktop/setup/install/windows-install/); enable virtualization and WSL 2. Use Linux containers.
- Restart the computer if requested.
- Open Docker Desktop and wait until it says Docker is running.

### macOS

Choose the correct Apple Silicon or Intel installer. Open Docker Desktop after installation and wait until it says Docker is running.

### Linux

Install Docker Desktop for your supported Linux distribution using the [Linux installation guide](https://docs.docker.com/desktop/setup/install/linux/). Check its virtualization requirements (including KVM). Docker Desktop is the required student path; Engine plus Compose is an instructor-managed advanced alternative.

## Step 3: Verify installation

Use Terminal on macOS/Linux and **Git Bash on Windows** for all Bash code blocks in this repository. Git Bash is included with Git for Windows and supports the quoted JSON and backslash continuations used in the labs. PowerShell uses different quoting and continuation rules.

Open your terminal:

```bash
git --version
docker --version
docker compose version
```

Use a current Docker Desktop release with Compose v2 or newer (`docker compose`, with a space). Each command should print a version. Also run `docker info` to verify the engine is running; a working CLI alone is insufficient.

## Step 4: Download the workshop

```bash
git clone https://github.com/darthvader58/api-scaling-workshop.git
cd api-scaling-workshop
```

This repository is public: cloning does not need a GitHub account. If asked for login, check the URL and your Git credential/proxy configuration with the instructor.

## Step 5: Start everything

```bash
docker compose up --build -d --wait
```

The first run downloads several images and may take several minutes. This is expected.

Check the containers:

```bash
docker compose ps
```

The API, database, Redis, worker, gateway, Prometheus, and Grafana containers should be running.

## Step 6: Run the first test

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"status":"ok"}
```

### Windows PowerShell alternative

If `curl` behaves differently in PowerShell, use:

```powershell
Invoke-WebRequest http://localhost:8080/health
```

## Step 7: Open the tools

- API: http://localhost:8080
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001

Grafana is configured for anonymous read-only access. Open [the provisioned workshop dashboard](http://localhost:3001/d/workshop) to see graphs without an account. Allow at least a minute of traffic for rate graphs.

## Step 8: Stop the workshop

```bash
docker compose down
```

This stops containers but keeps the local database and Redis volumes.

To completely reset the lab:

```bash
docker compose down -v
```

Use the reset command only when the instructor asks you to. It deletes local workshop data.

## Common beginner problems

### “Docker daemon is not running”

Open Docker Desktop and wait until it reports that Docker is running.

### “Port is already allocated”

Another program is using port 8080, 9090, or 3001. Ask the instructor before changing ports. Closing another development server usually fixes it.

### “The first command is still downloading”

The first build downloads images and npm packages. Let it finish. Later starts are much faster.

### “One container is unhealthy”

Run:

```bash
docker compose logs --tail=100 api db redis
```

Wait 10-20 seconds and run:

```bash
docker compose ps
```

### “My laptop is slow”

Close other applications and use 25 connections instead of 100. Keep enough Docker memory for the stack; reducing an already tight memory allocation can cause out-of-memory exits. Use `docker stats --no-stream` to inspect usage.

### Smoke test (all platforms)

```bash
docker compose exec -T api node scripts/smoke-test.js
```

In Git Bash/macOS/Linux, `./scripts/smoke-test.sh` runs the same check. It waits for readiness, checks SQL/cache/metrics, exhausts this client's rate-limit bucket, and submits a job. The worker must be running. A successful run prints `smoke test passed`.

### “503” immediately after scaling or recreation

HAProxy refreshes Docker DNS and checks API readiness. Wait up to 30 seconds, then run the smoke check. Check `docker compose logs --tail=100 gateway api worker` if it persists. `/health` checks the API process; `/ready` checks PostgreSQL and Redis too.

### Hostnames and ports

From your laptop use `localhost:8080`. Inside the load-test container use `gateway:8080`; its `localhost` is the load tester itself. PostgreSQL and Redis are deliberately not published to the host. Web ports bind to loopback only; these anonymous workshop services are not intended for LAN/internet deployment.

### Reset and initialization

SQL in `db/init` runs only when PostgreSQL first creates an empty data volume. Editing the SQL does not update an existing database. `docker compose down -v` deletes all workshop volumes and queued jobs; then start again to reseed 10,000 rows. Ordinary `down` retains data. Prometheus history is ephemeral and is lost when its container is removed.

### Configuration

Defaults work without `.env`. To tune the labs, copy `.env.example` to `.env`, edit its three settings, and recreate the affected API/worker service. Compose substitutes these variables; it does not pass arbitrary `.env` keys into containers. Keep `WORKER_DELAY_MS` between 0 and 5000.

## Optional native setup (advanced only)

A native installation is intentionally not the primary workshop path. It requires:

- Node.js 22;
- PostgreSQL 16;
- Redis 7;
- HAProxy;
- Prometheus;
- Grafana;
- npm packages;
- manual service startup and configuration.

The exact commands differ across operating systems. It also makes horizontal scaling and clean resets harder to explain. We can add a native appendix later for advanced students, but the live workshop should use Docker so everyone has the same environment.
