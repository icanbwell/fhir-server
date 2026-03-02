#!/bin/bash
# SSE Subscriptions Demo - Quick Commands
# Run these in order during the demo

# ============================================
# STEP 1: Get Token (Terminal 1)
# ============================================
export TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=bwell-client-id" \
  -d "client_secret=bwell-secret" \
  -d "grant_type=client_credentials" | jq -r '.access_token')
echo "✅ Token: ${TOKEN:0:30}..."

# ============================================
# STEP 2: Create Subscription (Terminal 1)
# ============================================
SUBSCRIPTION_RESPONSE=$(curl -s -X POST "http://localhost:3000/4_0_0/Subscription" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Subscription",
    "status": "active",
    "reason": "Real-time Patient updates for demo",
    "criteria": "Patient?",
    "channel": {
      "type": "message",
      "endpoint": "sse://localhost:3000/4_0_0/$subscription-events"
    },
    "meta": {
      "source": "demo",
      "security": [
        {"system": "https://www.icanbwell.com/access", "code": "bwell"},
        {"system": "https://www.icanbwell.com/owner", "code": "bwell"}
      ]
    }
  }')

export SUB_ID=$(echo $SUBSCRIPTION_RESPONSE | jq -r '.id')
echo "✅ Subscription created: $SUB_ID"
echo $SUBSCRIPTION_RESPONSE | jq '{id, status, criteria}'

# ============================================
# STEP 3: Connect to SSE (Terminal 2 - NEW TAB!)
# ============================================
# Copy and run this in a NEW terminal:
echo "
📋 COPY THIS TO TERMINAL 2:
----------------------------------------
export TOKEN=\$(curl -s -X POST \"http://localhost:8080/realms/master/protocol/openid-connect/token\" \\
  -H \"Content-Type: application/x-www-form-urlencoded\" \\
  -d \"client_id=bwell-client-id\" \\
  -d \"client_secret=bwell-secret\" \\
  -d \"grant_type=client_credentials\" | jq -r '.access_token')

curl -N -H \"Authorization: Bearer \$TOKEN\" \\
  \"http://localhost:3000/4_0_0/\\\$subscription-events/$SUB_ID\"
----------------------------------------
"

# ============================================
# STEP 4: Wait for SSE connection, then...
# ============================================
echo "⏳ Press ENTER after SSE connection shows handshake..."
read

# ============================================
# STEP 5: Create Patient (Terminal 1)
# ============================================
echo "📤 Creating Patient to trigger notification..."
curl -s -X POST "http://localhost:3000/4_0_0/Patient" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Patient",
    "name": [{"family": "Smith", "given": ["John"]}],
    "birthDate": "1990-01-15",
    "meta": {
      "source": "samsung-watch",
      "security": [
        {"system": "https://www.icanbwell.com/access", "code": "bwell"},
        {"system": "https://www.icanbwell.com/owner", "code": "bwell"}
      ]
    }
  }' | jq '{id, name: .name[0], message: "👆 Check Terminal 2 for notification!"}'

# ============================================
# STEP 6: Show ClickHouse Events
# ============================================
echo ""
echo "📊 Events stored in ClickHouse:"
docker exec fhir-clickhouse clickhouse-client --query \
  "SELECT event_id, subscription_id, trigger_resource_type, trigger_action, event_time 
   FROM fhir.fhir_subscription_events 
   ORDER BY event_time DESC 
   LIMIT 3"

# ============================================
# STEP 7: Show Subscription Status
# ============================================
echo ""
echo "📈 Subscription Status:"
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/4_0_0/Subscription/$SUB_ID/\$status" | jq '.entry[0].resource | {status, type, eventsSinceSubscriptionStart}'

# ============================================
# CLEANUP (after demo)
# ============================================
# curl -X DELETE -H "Authorization: Bearer $TOKEN" "http://localhost:3000/4_0_0/Subscription/$SUB_ID"
