#!/usr/bin/env sh
set -eu

BASE_URL="${1:-http://localhost:8080}"

printf 'Checking %s/health\n' "$BASE_URL"
health="$(curl -fsS "$BASE_URL/health")"
printf '%s\n' "$health"

printf 'Checking static route\n'
curl -fsS "$BASE_URL/api/v1/static" >/dev/null

printf 'Checking PostgreSQL route\n'
curl -fsS "$BASE_URL/api/v1/records/42" >/dev/null

printf 'Checking Redis-backed route\n'
curl -fsS "$BASE_URL/api/v1/cached-records/42" >/dev/null

printf 'Checking metrics endpoint\n'
curl -fsS "$BASE_URL/metrics" | grep -q 'workshop_http_requests_total'

printf 'Smoke test passed.\n'
