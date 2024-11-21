#!/bin/sh

# Default to 536870912 bytes (512 MB) if MAX_OLD_SPACE_SIZE is not set
: "${MAX_OLD_SPACE_SIZE_BYTES:=536870912}"

# Convert bytes to megabytes, rounding up to the nearest whole number
MAX_OLD_SPACE_SIZE_MB=$(( (MAX_OLD_SPACE_SIZE_BYTES + 1048576 - 1) / 1048576 ))

# Start the Node.js application with the calculated memory limit
exec node --max-old-space-size=$MAX_OLD_SPACE_SIZE_MB --require=./src/dd_instrumentation.js src/app.js
