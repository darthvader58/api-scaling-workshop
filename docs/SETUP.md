# Beginner Setup Guide

This workshop is designed for students who have not used Docker, Redis, PostgreSQL, or load-testing tools before.

## Recommended approach

Use Docker Desktop. Students only need to install:

1. Git
2. Docker Desktop

The repository supplies the API, PostgreSQL, Redis, HAProxy, Prometheus, Grafana, worker, and load tester.

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
- Use the WSL 2 backend if Docker offers the choice.
- Restart the computer if requested.
- Open Docker Desktop and wait until it says Docker is running.

### macOS

Choose the correct Apple Silicon or Intel installer. Open Docker Desktop after installation and wait until it says Docker is running.

### Linux

Docker Desktop is acceptable. Docker Engine plus the Compose plugin also works, but Docker Desktop is easier for a beginner workshop.

## Step 3: Verify installation

Open Terminal, PowerShell, or Git Bash:

```bash
git --version
docker --version
docker compose version
```

The exact version numbers are not important. Each command should print a version instead of an error.

## Step 4: Download the workshop

```bash
git clone <YOUR_REPOSITORY_URL>
cd api-scaling-workshop
```

If Git asks for a GitHub login, use the repository URL and GitHub authentication method provided by the instructor.

## Step 5: Start everything

```bash
docker compose up --build -d
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

Grafana is configured for anonymous read-only access in this workshop, so students do not need to create an account.

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

Reduce Docker Desktop CPU and memory usage, close other applications, or use smaller benchmark settings such as 25 connections instead of 100.

## Optional native setup

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
