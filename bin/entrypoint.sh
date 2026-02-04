#!/usr/bin/env bash
set -euo pipefail

# Start worker and MCP server in one container
python3 -m worker.main &
WORKER_PID=$!

node /app/server/dist/index.js &
SERVER_PID=$!

# If one dies — stop the other
wait -n $WORKER_PID $SERVER_PID
EXIT_CODE=$?

kill $WORKER_PID $SERVER_PID 2>/dev/null || true
exit $EXIT_CODE
