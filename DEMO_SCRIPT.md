# SSE FHIR Subscriptions Demo Script

## 🎯 Demo Overview
**Duration:** 10-15 minutes  
**User Story:** "As a b.well user, I want my health summary to update the moment my Samsung watch syncs my blood pressure"

---

## 📋 Pre-Demo Checklist

Before starting, ensure Docker Compose is running:
```bash
docker compose ps
```

Expected services: `fhir-server`, `mongo`, `redis`, `kafka`, `clickhouse`, `keycloak`

---

## 🎬 DEMO SCRIPT

### SLIDE 1: Introduction (1 min)

> "Today I'm going to demonstrate our new **Real-Time FHIR Subscriptions** feature using Server-Sent Events.
>
> **The Problem:** Currently, when new health data arrives—like a blood pressure reading from a Samsung watch—the frontend has to poll the server repeatedly to check for updates. This creates latency and unnecessary load.
>
> **The Solution:** With SSE Subscriptions, clients can subscribe to specific resource changes and receive **instant push notifications** when data lands."

---

### SLIDE 2: Architecture Overview (1 min)

> "Here's how it works:
>
> 1. **Client creates a Subscription** specifying what resources they want to monitor
> 2. **Client opens an SSE connection** - a persistent HTTP stream
> 3. **When data changes** (e.g., new Observation), Kafka emits an event
> 4. **Subscription Matcher** checks if any subscriptions match
> 5. **Notification is pushed** instantly to connected clients via SSE
> 6. **Events are stored** in ClickHouse for replay if client disconnects"

---

### SLIDE 3: Live Demo - Setup (2 min)

> "Let me show you this in action. First, I'll get an authentication token."

**[TERMINAL 1 - Run this command]**
```bash
export TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=bwell-client-id" \
  -d "client_secret=bwell-secret" \
  -d "grant_type=client_credentials" | jq -r '.access_token')
echo "Token acquired: ${TOKEN:0:30}..."
```

> "Token acquired. Now let's create a subscription for **Patient** resource changes."

---

### SLIDE 4: Create Subscription (2 min)

> "I'm creating a subscription that will notify me whenever a Patient resource is created or updated."

**[TERMINAL 1 - Run this command]**
```bash
curl -s -X POST "http://localhost:3000/4_0_0/Subscription" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Subscription",
    "status": "active",
    "reason": "Real-time Patient updates",
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
  }' | jq '{id: .id, status: .status, criteria: .criteria}'
```

> "The subscription is created with status **active**. Note the ID - we'll use it to connect."

**[Copy the subscription ID from output]**

---

### SLIDE 5: Connect to SSE Stream (2 min)

> "Now I'll open a persistent SSE connection. In a real app, this would be JavaScript's EventSource API."

**[TERMINAL 2 - Open a NEW terminal tab, run this]**
```bash
# Replace <SUBSCRIPTION_ID> with the ID from previous step
export TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=bwell-client-id" \
  -d "client_secret=bwell-secret" \
  -d "grant_type=client_credentials" | jq -r '.access_token')

curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/4_0_0/\$subscription-events/<SUBSCRIPTION_ID>"
```

> "You can see we received a **handshake event** confirming the connection is established. 
> The connection stays open, waiting for events.
> Every 30 seconds you'll see a heartbeat comment to keep the connection alive."

---

### SLIDE 6: Trigger a Notification (2 min)

> "Now, let's simulate what happens when a Samsung watch syncs new data. I'll create a Patient resource."

**[TERMINAL 1 - Run this command]**
```bash
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
  }' | jq '{id: .id, name: .name[0]}'
```

> "Patient created. **[Point to Terminal 2]** And look at our SSE connection - we **instantly** received a notification!
>
> The notification includes:
> - **SubscriptionStatus** with event number and subscription reference
> - **The full Patient resource** that was created
> - **The action** (POST = create)"

---

### SLIDE 7: Show Event Storage (1 min)

> "All events are persisted to ClickHouse for durability and replay."

**[TERMINAL 1 - Run this command]**
```bash
docker exec fhir-clickhouse clickhouse-client --query \
  "SELECT event_id, subscription_id, trigger_resource_type, trigger_action, event_time 
   FROM fhir.fhir_subscription_events 
   ORDER BY event_time DESC 
   LIMIT 3"
```

> "Events are stored with a 7-day TTL. If a client disconnects and reconnects, they can replay missed events using the Last-Event-ID header."

---

### SLIDE 8: Check Subscription Status (1 min)

> "We can also check the subscription status via the FHIR $status operation."

**[TERMINAL 1 - Run this command]**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/4_0_0/Subscription/<SUBSCRIPTION_ID>/\$status" | jq '.entry[0].resource'
```

> "This shows:
> - The subscription is **active**
> - Total events since subscription started
> - Number of active connections"

---

### SLIDE 9: Frontend Integration (1 min)

> "For frontend developers, integration is simple using the standard EventSource API:"

```javascript
const eventSource = new EventSource(
  'https://api.example.com/4_0_0/$subscription-events/abc123',
  { headers: { 'Authorization': 'Bearer ' + token } }
);

eventSource.addEventListener('notification', (event) => {
  const bundle = JSON.parse(event.data);
  const resource = bundle.entry[1]?.resource;
  
  // Update UI instantly
  updateHealthSummary(resource);
});
```

---

### SLIDE 10: Summary (1 min)

> "To summarize what we've built:
>
> ✅ **Real-time push notifications** via SSE  
> ✅ **FHIR R5 compliant** Subscription/SubscriptionStatus resources  
> ✅ **Durable event storage** in ClickHouse with replay  
> ✅ **Multi-pod support** via Redis Pub/Sub  
> ✅ **Heartbeat & reconnection** handling  
>
> **User Story Delivered:** When a Samsung watch syncs blood pressure, the health summary updates instantly - no polling required.
>
> Questions?"

---

## 🧹 Post-Demo Cleanup

```bash
# Delete the subscription
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/4_0_0/Subscription/<SUBSCRIPTION_ID>"

# Clear test events (optional)
docker exec fhir-clickhouse clickhouse-client --query \
  "TRUNCATE TABLE fhir.fhir_subscription_events"
```

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| Token expired | Re-run the token export command |
| SSE connection closes | Check server logs: `docker logs fhir-server-fhir-1 --tail 50` |
| No notification received | Verify Kafka is running: `docker exec fhir-server-kafka-1 kafka-topics.sh --list --bootstrap-server localhost:9092` |
| Content-Type error | Use `application/fhir+json` not `application/json` |
