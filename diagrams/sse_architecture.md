# SSE FHIR Subscriptions - Architecture Diagrams

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FHIR SERVER CLUSTER                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                     │
│  │  FHIR Pod 1  │     │  FHIR Pod 2  │     │  FHIR Pod N  │                     │
│  │              │     │              │     │              │                     │
│  │ ┌──────────┐ │     │ ┌──────────┐ │     │ ┌──────────┐ │                     │
│  │ │   SSE    │ │     │ │   SSE    │ │     │ │   SSE    │ │                     │
│  │ │Connection│ │     │ │Connection│ │     │ │Connection│ │                     │
│  │ │ Manager  │ │     │ │ Manager  │ │     │ │ Manager  │ │                     │
│  │ └────┬─────┘ │     │ └────┬─────┘ │     │ └────┬─────┘ │                     │
│  └──────┼───────┘     └──────┼───────┘     └──────┼───────┘                     │
│         │                    │                    │                              │
│         └────────────────────┼────────────────────┘                              │
│                              │                                                   │
│                    ┌─────────▼─────────┐                                        │
│                    │   Redis Pub/Sub   │  ← Cross-pod event dispatch            │
│                    │  (Event Channel)  │                                        │
│                    └─────────┬─────────┘                                        │
│                              │                                                   │
└──────────────────────────────┼──────────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    MongoDB    │    │     Kafka       │    │   ClickHouse    │
│               │    │                 │    │                 │
│ Subscriptions │    │  Change Events  │    │  Event Storage  │
│   Storage     │    │ (fhir.*.events) │    │  (30 day TTL)   │
└───────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 2. Event Flow Diagram

```
┌─────────────┐                                                    ┌─────────────┐
│   Samsung   │                                                    │  Frontend   │
│    Watch    │                                                    │    App      │
└──────┬──────┘                                                    └──────▲──────┘
       │                                                                  │
       │ 1. Sync blood pressure                                          │ 8. Real-time
       │    POST /Observation                                            │    notification
       │                                                                  │
       ▼                                                                  │
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                FHIR SERVER                                        │
│                                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │             │    │             │    │              │    │                 │  │
│  │   Route     │───▶│  PostSave   │───▶│    Kafka     │───▶│  Subscription   │  │
│  │  Handler    │    │  Manager    │    │  Producer    │    │  Kafka Consumer │  │
│  │             │    │             │    │              │    │                 │  │
│  └─────────────┘    └─────────────┘    └──────────────┘    └────────┬────────┘  │
│        │                                                             │           │
│        │ 2. Save to DB                                              │           │
│        ▼                                                             │           │
│  ┌─────────────┐                                                    │           │
│  │   MongoDB   │                                              3. Consume        │
│  │             │                                                 event          │
│  └─────────────┘                                                    │           │
│                                                                     ▼           │
│                                                          ┌──────────────────┐   │
│                                                          │  Subscription    │   │
│                                                          │    Matcher       │   │
│                                                          │                  │   │
│                                                          │ 4. Match against │   │
│                                                          │    active subs   │   │
│                                                          └────────┬─────────┘   │
│                                                                   │             │
│                           5. Build notification                   │             │
│                              FHIR Bundle                          ▼             │
│                                                          ┌──────────────────┐   │
│                                                          │ Notification     │   │
│                                                          │   Builder        │   │
│                                                          └────────┬─────────┘   │
│                                                                   │             │
│         ┌────────────────────────────────────────────────────────┬┘             │
│         │                                                        │              │
│         ▼                                                        ▼              │
│  ┌──────────────┐                                       ┌──────────────────┐    │
│  │  ClickHouse  │  6. Store event                       │ SSE Event        │    │
│  │              │     for replay                        │ Dispatcher       │    │
│  │ Event Store  │                                       │                  │    │
│  └──────────────┘                                       └────────┬─────────┘    │
│                                                                  │              │
│                                              7. Dispatch via     │              │
│                                                 Redis Pub/Sub    ▼              │
│                                                          ┌──────────────────┐   │
│                                                          │ SSE Connection   │   │
│                                                          │    Manager       │───┼──▶ SSE Stream
│                                                          │                  │   │    to Client
│                                                          └──────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Client Connection Flow

```
┌─────────────┐                              ┌─────────────────────────────────┐
│   Client    │                              │         FHIR Server             │
│  (Browser)  │                              │                                 │
└──────┬──────┘                              └────────────────┬────────────────┘
       │                                                      │
       │  1. Create Subscription                              │
       │  POST /4_0_0/Subscription                            │
       │  {"criteria": "Patient?", "channel.type": "message"} │
       │─────────────────────────────────────────────────────▶│
       │                                                      │
       │  Response: {"id": "sub-123", "status": "active"}     │
       │◀─────────────────────────────────────────────────────│
       │                                                      │
       │  2. Connect to SSE Stream                            │
       │  GET /4_0_0/$subscription-events/sub-123             │
       │  Accept: text/event-stream                           │
       │─────────────────────────────────────────────────────▶│
       │                                                      │
       │  3. Handshake Event                                  │
       │  event: handshake                                    │
       │  data: {"subscriptionId":"sub-123","status":"active"}│
       │◀─────────────────────────────────────────────────────│
       │                                                      │
       │            ┌─────────────────────────┐               │
       │            │  Connection Open        │               │
       │            │  Waiting for events...  │               │
       │            └─────────────────────────┘               │
       │                                                      │
       │  4. Heartbeat (every 30s)                            │
       │  :heartbeat                                          │
       │◀─────────────────────────────────────────────────────│
       │                                                      │
       │  5. Resource Created (Patient)                       │
       │  event: notification                                 │
       │  id: 1                                               │
       │  data: {"resourceType":"Bundle",...}                 │
       │◀─────────────────────────────────────────────────────│
       │                                                      │
       │  6. Another Resource Updated                         │
       │  event: notification                                 │
       │  id: 2                                               │
       │  data: {"resourceType":"Bundle",...}                 │
       │◀─────────────────────────────────────────────────────│
       │                                                      │
       │            ┌─────────────────────────┐               │
       │            │  Client Disconnects     │               │
       │            │  (network issue)        │               │
       │            └─────────────────────────┘               │
       │                                                      │
       │  7. Reconnect with Last-Event-ID                     │
       │  GET /4_0_0/$subscription-events/sub-123             │
       │  Last-Event-ID: 2                                    │
       │─────────────────────────────────────────────────────▶│
       │                                                      │
       │  8. Replay missed events (id > 2)                    │
       │  event: notification                                 │
       │  id: 3                                               │
       │  data: {"resourceType":"Bundle",...}                 │
       │◀─────────────────────────────────────────────────────│
       │                                                      │
       ▼                                                      ▼

