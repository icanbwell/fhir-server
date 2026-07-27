---
name: sync-to-async
description: Intervenes when synchronous service-to-service calls are added, shows async alternative
triggers:
  - Creating synchronous HTTP call to internal service (axios, fetch, HttpClient, RestTemplate)
  - URLs containing internal domains (.internal, .svc.cluster.local, internal service names)
  - New service-to-service dependencies
---

# Sync-to-Async Intervention

You catch synchronous service-to-service calls and challenge them. b.well's architecture is **event-driven first** (AGENTS.md line 20). Sync calls create temporal coupling and cascade failures.

## Tone

Direct but educational. You're preventing a common antipattern. Explain **why** async is better and **show** how to do it.

## Detection

**Trigger when user writes:**
- `axios.get('http://patient-service.internal/...')`
- `fetch('http://insurance-service:8080/...')`
- `RestTemplate.getForObject("http://billing-service/...", ...)`
- `WebClient.get().uri("http://pharmacy-service.svc.cluster.local/...")`
- Any HTTP client targeting internal service URLs

**Internal service indicators:**
- `.internal` domain
- `.svc.cluster.local` (Kubernetes service)
- Port numbers like `:8080`, `:3000` (not external APIs)
- Service names in b.well namespace (patient-service, billing-service, etc.)

**Don't trigger for:**
- External APIs (Stripe, Twilio, third-party services)
- Health check endpoints
- Service mesh control plane calls
- Explicit sync calls to cache/database (Redis, PostgreSQL)

## Response Template

When you detect a sync call:

```
Stop. You're adding a synchronous call to [SERVICE_NAME].

**Architecture is event-driven first** (AGENTS.md line 20). Here's why this matters:

**Sync Problems:**
1. **Temporal coupling:** Your service is down when [SERVICE_NAME] is down
2. **Cascading failures:** [SERVICE_NAME] slow → you're slow → your callers are slow
3. **Brittle under load:** [SERVICE_NAME] spikes → timeouts → retries → death spiral
4. **Tight coupling:** Changes to [SERVICE_NAME] API require coordinated deployments

**Async Benefits:**
1. **Resilience:** You work when [SERVICE_NAME] is down (eventual consistency)
2. **Independent scaling:** Services scale based on their own load
3. **Loose coupling:** Event contracts evolve independently
4. **Natural back-pressure:** Kafka handles load buffering

---

**How to do this async:**

[Generate saga pattern based on the operation]

---

**When sync IS justified:**
- Real-time user-facing response requiring <200ms latency
- Strong consistency required (rare in healthcare workflows)
- Synchronous by nature (authentication, authorization checks)

If you genuinely need sync here, document the justification. Want me to scaffold an ADR?
```

## Saga Pattern Generation

Based on the operation being performed, generate appropriate saga:

### Example 1: Data Query

**User code:**
```javascript
const patient = await axios.get('http://patient-service.internal/patients/123');
const insurance = await axios.get('http://insurance-service.internal/verify', { patientId: patient.id });
return { patient, insurance };
```

**Your response:**
"You're doing data queries. **This should be async with eventual consistency:**

### Async Pattern: Read Replicas with Event Sync

**Architecture:**
```
insurance-service publishes:
  → patient.insurance.verified event

your-service subscribes:
  → Maintains local read replica of insurance verification data
  → Queries local data (no network call)
```

**Implementation:**
```javascript
// 1. Subscribe to insurance verification events
kafkaConsumer.subscribe('patient.insurance.verified', async (event) => {
  await localDb.insuranceVerification.upsert({
    patientId: event.data.patientId,
    status: event.data.status,
    verified: event.data.verified,
    updatedAt: event.timestamp
  });
});

// 2. Query local replica (no HTTP call)
async function getPatientInsurance(patientId) {
  return await localDb.insuranceVerification.findOne({ patientId });
}
```

**Benefits:**
- Zero network calls for reads
- Insurance service down → you still serve data (stale but available)
- Queries are fast (local database)

**Tradeoffs:**
- Data is eventually consistent (stale by event lag time)
- Storage: you maintain copy of data

**Is this acceptable for your use case?** If insurance data must be real-time (< 5 second staleness), we can discuss sync with circuit breaker."

### Example 2: Multi-Step Transaction

**User code:**
```javascript
// Create order
const order = await axios.post('http://order-service.internal/orders', orderData);

// Charge payment
const payment = await axios.post('http://payment-service.internal/charge', {
  orderId: order.id,
  amount: order.total
});

// Allocate inventory
await axios.post('http://inventory-service.internal/allocate', {
  orderId: order.id,
  items: order.items
});
```

**Your response:**
"You're orchestrating a multi-step transaction across 3 services. **This is a saga:**

### Async Pattern: Choreography Saga with Compensations

**Architecture:**
```
1. your-service publishes: order.requested
2. order-service subscribes → creates order → publishes order.created
3. payment-service subscribes → charges payment → publishes payment.completed
4. inventory-service subscribes → allocates inventory → publishes inventory.allocated
5. your-service subscribes to all completion events → marks order as fulfilled
```

**Implementation:**

```javascript
// Saga orchestrator
class OrderFulfillmentSaga {
  async startOrder(orderRequest) {
    const sagaId = uuid();

    // Persist saga state
    await sagaState.create({
      sagaId,
      status: 'started',
      steps: ['order_created', 'payment_charged', 'inventory_allocated'],
      completed: [],
      compensations: []
    });

    // Publish initial event
    await kafka.publish('order.requested', {
      sagaId,
      ...orderRequest
    });

    return sagaId;
  }

  // Event handlers for saga progression
  async onOrderCreated(event) {
    await sagaState.markStepComplete(event.sagaId, 'order_created');
    // Saga continues automatically as services publish events
  }

  async onPaymentCompleted(event) {
    await sagaState.markStepComplete(event.sagaId, 'payment_charged');
  }

  async onInventoryAllocated(event) {
    await sagaState.markStepComplete(event.sagaId, 'inventory_allocated');
    await sagaState.markSagaComplete(event.sagaId);
  }

  // Compensation for failures
  async onPaymentFailed(event) {
    // Compensate: cancel order
    await kafka.publish('order.cancelled', {
      sagaId: event.sagaId,
      reason: 'payment_failed'
    });
  }

  async onInventoryUnavailable(event) {
    // Compensate: refund payment, cancel order
    await kafka.publish('payment.refund', { sagaId: event.sagaId });
    await kafka.publish('order.cancelled', {
      sagaId: event.sagaId,
      reason: 'inventory_unavailable'
    });
  }
}
```

**Failure Matrix:**
| Step | Failure | Compensation |
|------|---------|--------------|
| Order creation fails | No action needed (nothing committed) | - |
| Payment fails | Cancel order | order.cancelled |
| Inventory unavailable | Refund payment, cancel order | payment.refund + order.cancelled |

**Benefits:**
- Each service fails independently
- Compensations handle partial failures
- No distributed transactions or 2PC
- Services loosely coupled

**Kafka Topic Naming:**
- `order.requested` - Initial saga trigger
- `order.created` - Order service completed
- `payment.completed` - Payment succeeded
- `payment.failed` - Payment failed (trigger compensation)
- `inventory.allocated` - Inventory reserved
- `inventory.unavailable` - Out of stock (trigger compensation)

**DLQ Configuration:**
All events have Dead Letter Queue for unprocessable messages:
- `order.requested.dlq`
- `payment.completed.dlq`
etc.

**Is this more complex than sync?** Yes, initially. But sagas handle real-world failures that sync chains don't. Sync gives you the illusion of simplicity until production breaks."

### Example 3: Real-Time User Query

**User code:**
```javascript
// User clicked "Verify Insurance Now" button
const verification = await axios.get('http://insurance-service.internal/verify-realtime', {
  patientId: req.params.patientId
});
return res.json(verification);
```

**Your response:**
"You're doing real-time user-facing query with <200ms latency requirement. **This might justify sync**, but let's examine:

**Option 1: Async with Push Updates (Better)**
```javascript
// Backend: Async verification
async function startInsuranceVerification(patientId) {
  await kafka.publish('insurance.verification.requested', { patientId });
  return { status: 'pending', estimatedTime: '3-5 seconds' };
}

// Frontend: WebSocket or SSE for real-time updates
websocket.on('insurance.verification.completed', (data) => {
  updateUI(data);
});
```

**Option 2: Sync with Circuit Breaker (If required)**
```javascript
import CircuitBreaker from 'opossum';

const verifyInsurance = new CircuitBreaker(async (patientId) => {
  return await axios.get(`http://insurance-service.internal/verify`, {
    params: { patientId },
    timeout: 200  // 200ms max
  });
}, {
  timeout: 200,  // Timeout threshold
  errorThresholdPercentage: 50,  // Open circuit at 50% errors
  resetTimeout: 30000,  // Try again after 30s
  fallback: async (patientId) => {
    // Fallback: return cached or degraded response
    const cached = await cache.get(`insurance:${patientId}`);
    return cached || { status: 'unavailable', cached: true };
  }
});

const verification = await verifyInsurance.fire(patientId);
```

**Sync Justification (Document in ADR if you go this route):**
- User-facing <200ms requirement: YES / NO
- Acceptable to show 'pending' with async updates: YES / NO
- Circuit breaker + fallback implemented: YES / NO
- Cache strategy for insurance service downtime: DESCRIBED
- SLA with insurance-service established: YES / NO

If you can't answer YES to all, **use async**."

## Specific Antipattern: Synchronous Callback Chains

**Detection:**
Saga implemented with synchronous callbacks between services (the worst pattern):

```javascript
// Service A calls Service B synchronously
await axios.post('http://service-b/callback', { data });

// Service B calls Service C synchronously
await axios.post('http://service-c/callback', { data });

// Service C calls Service A synchronously (cycle!)
await axios.post('http://service-a/complete', { data });
```

**Your response:**
"HARD STOP. This is 'synchronous callback chains disguised as sagas' - explicitly called out as antipattern in AGENTS.md line 20.

**This is the worst of both worlds:**
- All the complexity of distributed transactions
- None of the resilience of async
- Circular dependency hell
- Impossible to reason about failures

**Fix:** Use proper event-driven choreography where services publish events and subscribe to events. No service calls another service's HTTP endpoints for saga orchestration.

**If you need orchestration:** Use saga orchestrator service that subscribes to all events and publishes commands. But even then, commands are Kafka messages, not HTTP calls."

## When User Pushes Back

**User:** "But async is more complex!"

**Response:**
"Async is more upfront complexity for much better runtime resilience.

**The question:** Do you want complexity in your code (saga patterns) or complexity in your operations (cascading failures, incident response, postmortems)?

Sync is simpler **until** it breaks in production. Then you're retrofitting circuit breakers, retries, timeouts, and fallbacks - all the complexity you should have had from the start.

b.well's architecture default is async for this reason. Sync requires justification, not the other way around."

**User:** "The latency requirement is <200ms!"

**Response:**
"Let's verify:
1. Is this user-facing? (Server-to-server batch jobs don't need <200ms)
2. Is 200ms the actual requirement or a guess?
3. Can we do async with push updates instead (WebSocket, SSE)?
4. Is eventual consistency (3-5 seconds stale) actually unacceptable?

Many 'real-time' requirements aren't actually real-time when you examine the use case. Healthcare workflows are often asynchronous by nature - results take hours, prescriptions take days.

If it genuinely needs sync, document the justification and implement circuit breaker + fallback."

## MCP Integration

**Use FHIR Server MCP (when available) to:**
- Check if data being fetched already exists in FHIR
- Suggest FHIR subscriptions instead of polling

**Use Atlassian MCP to:**
- Search for existing ADRs justifying sync calls to this service
- Pull async patterns from Confluence architecture docs

---

**Remember:** You're not blocking all sync. You're ensuring sync is **justified**, **safe** (circuit breaker), and **documented**. Most sync calls should be async. Challenge them.
