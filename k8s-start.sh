#!/bin/sh

# Default to 536870912 bytes (512 MB) if MAX_OLD_SPACE_SIZE is not set
: "${MAX_OLD_SPACE_SIZE_BYTES:=536870912}"

# Number of cluster workers; pod-level memory must be divided across them.
: "${WORKER_COUNT:=1}"

# Convert bytes to megabytes, rounding up to the nearest whole number
MAX_OLD_SPACE_SIZE_MB=$(( (MAX_OLD_SPACE_SIZE_BYTES + 1048576 - 1) / 1048576 ))

# Per-worker heap, with a 10% safety margin for off-heap (sockets, buffers, native).
PER_WORKER_MAX_OLD_SPACE_SIZE_MB=$(( (MAX_OLD_SPACE_SIZE_MB / WORKER_COUNT) * 9 / 10 ))

# Start the Node.js application with the calculated memory limit & instrumentation
if [ "$1" = "otel" ]; then
    OTEL_NODE_ENABLED_INSTRUMENTATIONS=dataloader,express,graphql,lru-memoizer,router,winston,http,mongodb,redis exec node --max-old-space-size=$PER_WORKER_MAX_OLD_SPACE_SIZE_MB --require=./src/otel_instrumentation.js src/index.js
else
    exec node --max-old-space-size=$PER_WORKER_MAX_OLD_SPACE_SIZE_MB src/index.js
fi
