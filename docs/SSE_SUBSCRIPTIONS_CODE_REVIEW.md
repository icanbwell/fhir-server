# SSE FHIR Subscriptions - Code Review Document

**Feature**: Server-Sent Events (SSE) for FHIR R5 Subscriptions  
**Branch**: `sse-integration`  
**Date**: February 24, 2026  
**Author**: Development Team  

---

## 1. Executive Summary

This implementation adds real-time push notifications to the FHIR server using Server-Sent Events (SSE), following the FHIR R5 Subscriptions Implementation Guide with R4 backport compatibility.

### Architecture Highlights
- **Stateless FHIR Server**: Per Bill Field's requirements, the FHIR server remains stateless
- **Redis Pub/Sub**: Cross-pod event broadcasting for horizontal scaling
- **ClickHouse**: Event persistence for replay on reconnection
- **Kafka**: Event source for resource change notifications

---

## 2. Files Changed Summary

| Category | Files Added | Files Modified |
|----------|-------------|----------------|
| Services | 6 | 0 |
| Handlers | 0 | 1 |
| Utils | 4 | 2 |
| Config | 0 | 1 |
| Tests | 6 | 0 |
| Data Layer | 1 | 0 |
| Database Schema | 0 | 1 |
| Documentation | 1 | 1 |
| **Total** | **18** | **6** |

---

## 3. New Files

### 3.1 Services

#### `src/services/sseConnectionManager.js`
**Purpose**: Manages active SSE connections per pod

**Key Features**:
- Singleton pattern with `getSSEConnectionManager()`
- Connection registration with timeout support
- Broadcast to subscription connections
- Connection cleanup on close/error/timeout
- OpenTelemetry metrics integration

**Public API**:
```javascript
registerConnection({ subscriptionId, clientId, writer, lastEventId, request, timeoutMs })
removeConnection(connectionId)
getConnectionsForSubscription(subscriptionId)
broadcastToSubscription({ subscriptionId, notification })
closeAllForSubscription(subscriptionId, reason)
getStats()
```

---

#### `src/services/sseEventDispatcher.js`
**Purpose**: Cross-pod event distribution via Redis Pub/Sub

**Key Features**:
- Publishes events to Redis channel `fhir:sse:subscription:{subscriptionId}`
- Subscribes to pattern for incoming events from other pods
- Local broadcast fallback if Redis fails
- Event metrics tracking

**Flow**:
```
Kafka Event → SubscriptionMatcher → SSEEventDispatcher 
    → Redis Pub/Sub → All Pods → SSEConnectionManager → Client
```

---

#### `src/services/subscriptionMatcher.js`
**Purpose**: Matches resource changes to active subscriptions

**Key Features**:
- In-memory subscription cache with periodic refresh
- Parses R4 criteria strings and R5 filterBy expressions
- Supports resource type, patient reference, and custom filters
- Cache invalidation on subscription changes

---

#### `src/services/subscriptionKafkaConsumer.js`
**Purpose**: Consumes Kafka events and triggers SSE notifications

**Kafka Topics**:
- `business.events`
- `fhir.patient_data.change.events`
- `fhir.person_data.change.events`

---

#### `src/services/subscriptionTopicManager.js`
**Purpose**: Provides SubscriptionTopic fixtures and validation

**Built-in Topics**:
| ID | URL | Resource |
|----|-----|----------|
| `patient-changes` | `https://bwell.zone/fhir/SubscriptionTopic/patient-changes` | Patient |
| `observation-results` | `https://bwell.zone/fhir/SubscriptionTopic/observation-results` | Observation |
| `encounter-events` | `https://bwell.zone/fhir/SubscriptionTopic/encounter-events` | Encounter |
| `all-resources` | `https://bwell.zone/fhir/SubscriptionTopic/all-resources` | Resource (any) |

---

### 3.2 Handlers

#### `src/preSaveHandlers/handlers/subscriptionPreSaveHandler.js`
**Purpose**: Validates Subscription resources before save

**Validations**:
1. Channel type must be `message` (SSE)
2. Topic URL must exist in fixtures
3. End time must be in the future
4. Auto-activates `requested` → `active`
5. Adds SSE meta tag

---

### 3.3 Utils

#### `src/utils/sseResponseWriter.js`
**Purpose**: Writable stream for SSE protocol

**Features**:
- Proper SSE formatting (`id:`, `event:`, `data:`, `retry:`)
- Automatic heartbeat (configurable interval)
- Multiline data support
- Handshake event on connection

---

#### `src/utils/sseMetrics.js`
**Purpose**: OpenTelemetry metrics for SSE monitoring

**Metrics**:
| Metric | Type | Description |
|--------|------|-------------|
| `fhir_sse_connections_total` | Counter | Total connections established |
| `fhir_sse_events_dispatched_total` | Counter | Events sent to clients |
| `fhir_sse_replay_events_total` | Counter | Replay events on reconnect |
| `fhir_sse_errors_total` | Counter | Error count |
| `fhir_sse_active_connections` | Gauge | Current active connections |
| `fhir_sse_event_latency_ms` | Histogram | Event dispatch latency |
| `fhir_sse_replay_duration_ms` | Histogram | Replay operation duration |

---

#### `src/utils/subscriptionExpirationProcessor.js`
**Purpose**: Cron job to deactivate expired subscriptions

**Behavior**:
- Runs every minute (configurable)
- Finds subscriptions where `status=active` AND `end < now`
- Updates status to `off`
- Closes active SSE connections with error message
- Adds deactivation reason extension

---

### 3.4 Data Layer

#### `src/dataLayer/subscriptionEventStore.js`
**Purpose**: ClickHouse persistence for event replay

**Features**:
- Store events with sequence numbers
- Replay events after a given sequence number
- Statistics queries
- Automatic TTL cleanup (default: 7 days)

---

### 3.5 Database Schema

#### `clickhouse-init/01-init-schema.sql`
**Added Tables**:
```sql
CREATE TABLE fhir.fhir_subscription_events (
    event_id String,
    sequence_number UInt64,
    subscription_id String,
    topic_url String,
    event_type String,
    event_time DateTime64(3),
    trigger_resource_type String,
    trigger_resource_id String,
    trigger_action String,
    payload String,
    request_id String,
    client_id String
) ENGINE = MergeTree()
ORDER BY (subscription_id, sequence_number)
TTL event_time + INTERVAL 7 DAY;
```

---

## 4. Modified Files

### 4.1 `src/app.js`

**Changes**:
- Added imports for SSE handlers
- Added SSE router with authentication
- Registered routes:

| Route | Handler | Purpose |
|-------|---------|---------|
| `GET /4_0_0/$subscription-events/:subscriptionId` | `handleSubscriptionEvents` | SSE stream |
| `GET /4_0_0/$subscription-stats/:subscriptionId` | `handleSubscriptionStats` | Subscription stats |
| `GET /4_0_0/Subscription/:id/$status` | `handleSubscriptionStatus` | FHIR $status operation |
| `GET /4_0_0/Subscription/:id/$events` | `handleSubscriptionEventsHistory` | Historical events |
| `GET /4_0_0/SubscriptionTopic` | `handleSubscriptionTopicSearch` | Search topics |
| `GET /4_0_0/SubscriptionTopic/:id` | `handleSubscriptionTopicRead` | Read topic |
| `GET /admin/sse-stats` | `handleSSEAdminStats` | Admin stats |

---

### 4.2 `src/createContainer.js`

**Changes**:
- Added imports for all SSE services
- Registered services:
  - `sseConnectionManager`
  - `sseEventDispatcher`
  - `subscriptionMatcher`
  - `subscriptionKafkaConsumer`
  - `subscriptionEventStore`
  - `subscriptionTopicManager`
  - `subscriptionExpirationProcessor`
- Added `SubscriptionPreSaveHandler` to preSaveManager

---

### 4.3 `src/index.js`

**Changes**:
- Initialize `subscriptionExpirationProcessor` on startup
- Initialize `SSEMetrics` if SSE enabled

---

### 4.4 `src/utils/configManager.js`

**New Config Options**:
| Config | Env Variable | Default | Description |
|--------|--------------|---------|-------------|
| `enableSSESubscriptions` | `ENABLE_SSE_SUBSCRIPTIONS` | `false` | Enable SSE feature |
| `sseHeartbeatIntervalMs` | `SSE_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat interval |
| `sseReconnectRetryMs` | `SSE_RECONNECT_RETRY_MS` | `3000` | Client retry hint |
| `sseReplayLimit` | `SSE_REPLAY_LIMIT` | `1000` | Max replay events |
| `subscriptionEventRetentionDays` | `SUBSCRIPTION_EVENT_RETENTION_DAYS` | `7` | ClickHouse TTL |
| `sseKafkaTopics` | `SSE_KAFKA_TOPICS` | (see code) | Kafka topics |
| `sseKafkaConsumerGroupId` | `SSE_KAFKA_CONSUMER_GROUP_ID` | `fhir-sse-subscription-consumer` | Consumer group |
| `subscriptionExpirationCronTime` | `SUBSCRIPTION_EXPIRATION_CRON_TIME` | `* * * * *` | Cron schedule |
| `sseConnectionTimeoutMs` | `SSE_CONNECTION_TIMEOUT_MS` | `86400000` (24h) | Connection timeout |

---

### 4.5 `src/routeHandlers/subscriptionNotifications.js`

**Handlers Added**:
- `handleSubscriptionEvents` - Main SSE streaming endpoint
- `handleSubscriptionStats` - Per-subscription statistics
- `handleSSEAdminStats` - Admin overview
- `handleSubscriptionTopicSearch` - Search SubscriptionTopic
- `handleSubscriptionTopicRead` - Read SubscriptionTopic by ID
- `handleSubscriptionStatus` - FHIR $status operation
- `handleSubscriptionEventsHistory` - FHIR $events operation

---

## 5. Tests Added

| Test File | Coverage |
|-----------|----------|
| `src/tests/unit/services/sseConnectionManager.test.js` | Connection management |
| `src/tests/unit/services/subscriptionTopicManager.test.js` | Topic fixtures and search |
| `src/tests/unit/services/subscriptionPreSaveHandler.test.js` | Pre-save validation |
| `src/tests/unit/utils/sseMetrics.test.js` | Metrics recording |
| `src/tests/unit/utils/subscriptionExpirationProcessor.test.js` | Expiration processing |
| `src/tests/integration/sse/subscriptionTopicEndpoint.test.js` | Endpoint integration |

---

## 6. Security Considerations

### Authentication
- All SSE endpoints require JWT authentication via `sseStrategy`
- Subscription ownership validated against `clientId` from JWT

### Authorization
- Users can only subscribe to their own subscriptions
- Admin stats endpoint requires admin JWT

### Data Protection
- Subscription payloads respect existing FHIR access controls
- No cross-tenant data leakage

---

## 7. Performance Considerations

### Scalability
- Stateless design allows horizontal pod scaling
- Redis Pub/Sub handles cross-pod communication
- In-memory subscription cache reduces DB queries

### Resource Management
- Connection timeout prevents resource exhaustion (default: 24h)
- Heartbeat keeps connections alive through proxies
- ClickHouse TTL auto-cleans old events

### Monitoring
- OpenTelemetry metrics for observability
- Connection and event statistics endpoints

---

## 8. Deployment Notes

### Prerequisites
- Redis instance for Pub/Sub
- ClickHouse with schema migration applied
- Kafka topics configured

### Environment Variables
```bash
ENABLE_SSE_SUBSCRIPTIONS=true
SSE_HEARTBEAT_INTERVAL_MS=30000
SSE_REPLAY_LIMIT=1000
SSE_CONNECTION_TIMEOUT_MS=86400000
SUBSCRIPTION_EVENT_RETENTION_DAYS=7
```

### Feature Flag
Set `ENABLE_SSE_SUBSCRIPTIONS=true` to enable. When disabled:
- SSE endpoints return 501 Not Implemented
- Pre-save handler passes through without validation
- Cron job skips processing

---

## 9. FHIR Compliance

### R5 Subscriptions IG
- ✅ SubscriptionTopic discovery
- ✅ SubscriptionStatus notifications
- ✅ `$status` operation
- ✅ `$events` operation
- ✅ Event sequence numbers
- ✅ Reconnection with `Last-Event-Id`

### Notification Types
- `handshake` - On connection establishment
- `heartbeat` - Periodic keepalive
- `event-notification` - Resource change events
- `error` - Error notifications

---

## 10. Rollback Plan

1. Set `ENABLE_SSE_SUBSCRIPTIONS=false`
2. No database rollback required (feature flag disables all functionality)
3. ClickHouse tables can remain (TTL will clean up)

---

## 11. Testing Checklist

- [ ] Create Subscription with `channel.type=message`
- [ ] Connect to SSE endpoint with valid JWT
- [ ] Verify handshake event received
- [ ] Verify heartbeat events at interval
- [ ] Trigger resource change and verify notification
- [ ] Disconnect and reconnect with `Last-Event-Id`
- [ ] Verify replay of missed events
- [ ] Test subscription expiration
- [ ] Test connection timeout
- [ ] Verify metrics in monitoring system

---

## 12. Reviewer Checklist

- [ ] Code follows existing patterns
- [ ] Error handling is comprehensive
- [ ] Logging is appropriate (not excessive)
- [ ] No security vulnerabilities
- [ ] Tests cover critical paths
- [ ] Documentation is complete
- [ ] Performance impact acceptable
- [ ] Feature flag allows safe rollback

---

## 13. Open Questions / Future Work

1. **Prometheus vs OTEL**: Currently using OpenTelemetry metrics. Should we also expose Prometheus endpoint?
2. **Rate Limiting**: No per-client connection limits currently. May need for production.
3. **Webhook Support**: Current implementation is SSE-only. REST-hook support could be added later.
4. **Topic Customization**: Topics are currently fixtures. Database-backed topics could be added.

---

**Approved By**: ____________________  
**Date**: ____________________
