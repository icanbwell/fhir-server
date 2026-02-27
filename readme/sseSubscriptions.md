# SSE-based FHIR Subscriptions

The Helix FHIR Server supports real-time push notifications using **Server-Sent Events (SSE)** as defined in the FHIR R5 Subscriptions specification.

## 🎬 Demo Video

Watch a live demonstration of SSE Subscriptions in action:  
**[SSE Subscriptions Demo Video](https://drive.google.com/file/d/1F2g9gqt3gUmogJ1rMQVfn8Y7i7UbA74y/view?usp=sharing)**

## Overview

SSE Subscriptions enable clients to receive real-time notifications when FHIR resources change, eliminating the need for polling. This implementation follows the [FHIR R5 Subscriptions IG](http://hl7.org/fhir/R5/subscriptions.html) with R4 resource compatibility via the [Subscriptions Backport IG](http://hl7.org/fhir/uv/subscriptions-backport/).

## Quick Start

### 1. Create a Subscription

```http
POST /4_0_0/Subscription
Content-Type: application/fhir+json
Authorization: Bearer <your-token>

{
  "resourceType": "Subscription",
  "status": "requested",
  "reason": "Monitor patient updates",
  "criteria": "Patient",
  "channel": {
    "type": "server-sent-events",
    "endpoint": "https://your-fhir-server/4_0_0/$subscription-events"
  }
}
```

### 2. Connect to SSE Stream

```http
GET /4_0_0/$subscription-events/{subscriptionId}
Accept: text/event-stream
Authorization: Bearer <your-token>
```

### 3. Receive Events

```
event: handshake
id: handshake-uuid
data: {"resourceType":"Bundle","type":"subscription-notification",...}

event: heartbeat
id: heartbeat-1
data: {"resourceType":"Bundle","type":"subscription-notification",...}

event: notification
id: 42
data: {"resourceType":"Bundle","type":"subscription-notification",...}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_SSE_SUBSCRIPTIONS` | `false` | Enable SSE subscription endpoints |
| `SSE_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat interval in milliseconds |
| `SSE_RECONNECT_RETRY_MS` | `3000` | Client retry delay sent in SSE stream |
| `SSE_REPLAY_LIMIT` | `1000` | Maximum events to replay on reconnect |
| `SSE_CONNECTION_TIMEOUT_MS` | `3600000` | Connection timeout (1 hour default) |

### Redis Configuration (Required for multi-pod)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | - | Redis password (if required) |
| `REDIS_TLS` | `false` | Enable TLS for Redis connection |

### Kafka Configuration (Required for event sourcing)

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_ENABLE_EVENTS` | `false` | Enable Kafka event consumption |
| `KAFKA_RESOURCE_CHANGE_TOPIC` | `business.events` | Topic for resource change events |

### ClickHouse Configuration (Required for event replay)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLICKHOUSE_HOST` | `localhost` | ClickHouse server host |
| `CLICKHOUSE_PORT` | `8123` | ClickHouse HTTP port |
| `CLICKHOUSE_DATABASE` | `default` | ClickHouse database name |

## API Endpoints

### Connect to Subscription Events

```
GET /4_0_0/$subscription-events/{subscriptionId}
```

**Headers:**
- `Accept: text/event-stream` (required)
- `Authorization: Bearer <token>` (required)
- `Last-Event-Id: <event-id>` (optional, for replay)

**Response:** SSE event stream

### Get Subscription Statistics

```
GET /4_0_0/$subscription-stats/{subscriptionId}
```

**Response:**
```json
{
  "subscriptionId": "sub-123",
  "activeConnections": 2,
  "connectedClients": [
    {
      "connectionId": "conn-1",
      "clientId": "client-abc",
      "connectedAt": "2026-02-22T10:00:00Z"
    }
  ],
  "events": {
    "totalEvents": 42,
    "lastEventAt": "2026-02-22T10:30:00Z"
  }
}
```

### Get Server SSE Statistics (Admin)

```
GET /admin/sse-stats
```

**Response:**
```json
{
  "connections": {
    "totalConnections": 150,
    "activeSubscriptions": 45,
    "subscriptionCounts": {
      "sub-1": 3,
      "sub-2": 2
    },
    "podId": "pod-abc123"
  },
  "kafkaConsumer": {
    "isRunning": true,
    "groupId": "fhir-subscription-consumer-pod-abc123",
    "topics": ["business.events"]
  },
  "dispatcher": {
    "podId": "pod-abc123",
    "isInitialized": true,
    "subscribedPattern": "fhir:sse:subscription:*"
  }
}
```

## Event Types

### Handshake Event

Sent immediately when a client connects:

```json
{
  "resourceType": "Bundle",
  "type": "subscription-notification",
  "entry": [{
    "resource": {
      "resourceType": "SubscriptionStatus",
      "type": "handshake",
      "status": "active",
      "subscription": { "reference": "Subscription/123" }
    }
  }]
}
```

### Heartbeat Event

Sent periodically to keep the connection alive:

```json
{
  "resourceType": "Bundle",
  "type": "subscription-notification",
  "entry": [{
    "resource": {
      "resourceType": "SubscriptionStatus",
      "type": "heartbeat",
      "status": "active"
    }
  }]
}
```

### Notification Event

Sent when a matching resource changes:

```json
{
  "resourceType": "Bundle",
  "type": "subscription-notification",
  "entry": [{
    "resource": {
      "resourceType": "SubscriptionStatus",
      "type": "event-notification",
      "eventsSinceSubscriptionStart": "42",
      "subscription": { "reference": "Subscription/123" },
      "notificationEvent": [{
        "eventNumber": "42",
        "focus": { "reference": "Patient/456" }
      }]
    }
  }]
}
```

## Event Replay

When a client reconnects with `Last-Event-Id` header, missed events are automatically replayed:

```http
GET /4_0_0/$subscription-events/sub-123
Accept: text/event-stream
Authorization: Bearer <token>
Last-Event-Id: 35
```

Events 36 through current will be replayed, then the stream continues with live events.

## Architecture

### Stateless Design

The FHIR server remains stateless for horizontal scaling:

1. **Redis Pub/Sub** - Cross-pod event broadcasting
2. **Redis Hashes** - Connection metadata storage with TTL
3. **ClickHouse** - Event persistence for replay

### Component Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Kafka     │────▶│ FHIR Server │────▶│ SSE Client  │
│  Consumer   │     │   Pod N     │     │             │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │    Redis    │
                    │   Pub/Sub   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │  Pod 1   │     │  Pod 2   │     │  Pod N   │
    │  (SSE)   │     │  (SSE)   │     │  (SSE)   │
    └──────────┘     └──────────┘     └──────────┘
```

## Subscription Criteria (MVP)

Currently supported resource types:

| Resource Type | Trigger Events |
|---------------|----------------|
| Patient | Create, Update |
| Observation | Create, Update |
| Encounter | Create, Update |
| DiagnosticReport | Create, Update |

## Client Example (JavaScript)

```javascript
const eventSource = new EventSource(
  'https://fhir.example.com/4_0_0/$subscription-events/sub-123',
  {
    headers: {
      'Authorization': 'Bearer ' + accessToken
    }
  }
);

eventSource.addEventListener('handshake', (event) => {
  console.log('Connected:', JSON.parse(event.data));
});

eventSource.addEventListener('notification', (event) => {
  const bundle = JSON.parse(event.data);
  const focus = bundle.entry[0].resource.notificationEvent[0].focus;
  console.log('Resource changed:', focus.reference);
});

eventSource.addEventListener('heartbeat', (event) => {
  console.log('Heartbeat received');
});

eventSource.onerror = (error) => {
  console.error('SSE Error:', error);
  // EventSource will auto-reconnect
};
```

## Monitoring

### Prometheus Metrics (Planned)

- `fhir_sse_connections_total` - Total active SSE connections
- `fhir_sse_events_dispatched_total` - Events dispatched by type
- `fhir_sse_replay_events_total` - Events replayed on reconnect

### Logging

SSE events are logged with these fields:
- `subscriptionId` - Subscription being notified
- `connectionId` - Unique connection identifier
- `clientId` - Client identifier from auth token
- `eventType` - handshake, heartbeat, notification

## Troubleshooting

### Connection Drops Frequently

1. Check `SSE_HEARTBEAT_INTERVAL_MS` - may need to be lower if load balancer times out
2. Verify no proxy/CDN is buffering responses
3. Check `X-Accel-Buffering: no` header is being sent

### Events Not Being Received

1. Verify Kafka consumer is running: `GET /admin/sse-stats`
2. Check subscription is `active` status
3. Verify resource type matches subscription criteria

### Replay Not Working

1. Verify ClickHouse is accessible
2. Check `Last-Event-Id` header is being sent
3. Verify events exist within replay retention period (7 days default)

## Related Documentation

- [Architecture Document](../docs/architecture/sse-fhir-subscriptions-architecture.md)
- [Kafka Events](kafkaEvents.md)
- [ClickHouse Integration](clickhouse.md)
