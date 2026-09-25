#!/usr/bin/env sh
set -eu
# Use the API image's Node runtime; students only need Docker and Git.
docker compose exec -T api node scripts/smoke-test.js "${1:-http://gateway:8080}"
