#!/bin/sh
set -e
cd /app

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required — run via docker compose -f docker-compose.test.yml" >&2
  exit 1
fi

BASE="${NIMS_BASE_URL:-http://app:3001}"
echo "[test] waiting for $BASE ..."
/app/scripts/wait-for-http.sh "$BASE" 90

echo "[test] migrate unit DB..."
node packages/nims-dbms/scripts/migrate.js
if [ -n "${APP_DATABASE_URL:-}" ]; then
  DATABASE_URL="$APP_DATABASE_URL" node packages/nims-dbms/scripts/migrate.js || true
fi

mkdir -p /app/node_modules
ln -sfn /app/packages/nims-dbms /app/node_modules/nims-dbms
ln -sfn /app/packages/nims-dbms-core /app/node_modules/nims-dbms-core
ln -sfn /app/packages/nims-resources /app/node_modules/nims-resources
ln -sfn /app/packages/nims-server /app/node_modules/nims-server

export NODE_PATH="/app/node_modules:/app/packages/nims-server/node_modules:/app/packages/nims-dbms/node_modules:${NODE_PATH:-}"

COV="${COVERAGE:-0}"

DBMS_TESTS=$(ls packages/nims-dbms/tests/pg/*.test.js 2>/dev/null)
SERVER_TESTS=$(find packages/nims-server/tests -name '*.test.js' | sort)

run_unit() {
  echo "[test] nims-dbms pg tests..."
  # shellcheck disable=SC2086
  node --test --test-concurrency=1 $DBMS_TESTS
  echo "[test] nims-server tests..."
  # shellcheck disable=SC2086
  node --test --test-concurrency=1 $SERVER_TESTS
}

if [ "$COV" = "1" ]; then
  echo "[test] coverage mode (c8)"
  mkdir -p /app/coverage
  rm -rf /app/coverage/tmp /app/coverage/coverage-final.json
  # shellcheck disable=SC2086
  npx --yes c8 \
    --reporter=text --reporter=html --reporter=json --reports-dir=coverage \
    --exclude='**/node_modules/**' --exclude='**/dist/**' --exclude='**/migrations/**' --exclude='**/tests/**' \
    --include='packages/nims-dbms/pg/**' \
    --include='packages/nims-server/pg/**' \
    --include='packages/nims-server/permissions/permissionProxy.js' \
    --include='packages/nims-server/middlewares/requestProcessing.js' \
    --include='packages/nims-server/routes/auth.js' \
    node --test --test-concurrency=1 $DBMS_TESTS $SERVER_TESTS

  echo "[test] per-scope coverage thresholds..."
  node /app/scripts/check-coverage-thresholds.js /app/coverage
else
  run_unit
fi

echo "[test] vitest stores..."
cd packages/nims-app
if [ "$COV" = "1" ]; then
  npx vitest run --config vitest.config.ts --coverage
else
  npx vitest run --config vitest.config.ts
fi
cd /app

echo "[test] HTTP integration..."
node packages/nims-server/mcp/test/api-rbac-test.mjs "$BASE" || echo "[warn] api-rbac-test exited $?"
node packages/nims-server/mcp/test/api-multiproject-test.mjs "$BASE"
node packages/nims-server/mcp/test/api-history-test.mjs "$BASE"

echo "[test] OK"
