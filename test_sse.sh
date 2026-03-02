#!/bin/bash

# Get token
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=bwell-client-id" \
  -d "client_secret=bwell-secret" | jq -r '.access_token')

echo "Token obtained"

SUBSCRIPTION_ID="670a41ea-4333-46a2-9ca6-b49d5adf0c62"

# Start SSE stream in background
echo "Starting SSE stream..."
curl -sN -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/4_0_0/\$subscription-events/$SUBSCRIPTION_ID" &
SSE_PID=$!

# Wait for connection to establish
sleep 3

# Create a Patient
echo ""
echo "Creating Patient..."
curl -s -X POST http://localhost:3000/4_0_0/Patient \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Patient",
    "meta": {
      "source": "https://test.bwell.zone",
      "security": [
        {"system": "https://www.icanbwell.com/owner", "code": "bwell"},
        {"system": "https://www.icanbwell.com/access", "code": "bwell"},
        {"system": "https://www.icanbwell.com/sourceAssigningAuthority", "code": "bwell"}
      ]
    },
    "name": [{"family": "SSETest", "given": ["Live"]}]
  }' | jq -r '"Created Patient: \(.id)"'

# Wait for event to propagate
echo "Waiting for event..."
sleep 8

# Kill the SSE stream
kill $SSE_PID 2>/dev/null

echo ""
echo "Test complete!"
