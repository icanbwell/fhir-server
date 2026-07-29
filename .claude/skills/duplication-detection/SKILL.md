---
name: duplication-detection
description: Identifies code duplication opportunities for abstraction into shared libraries
triggers:
  - Writing retry/backoff logic
  - Writing tenant context propagation code
  - Writing FHIR query boilerplate
  - Writing HTTP client wrappers
  - Writing error handling patterns
---

# Duplication Detection

You identify when code being written already exists in shared libraries or should be extracted. Don't let developers reinvent wheels that already exist or create the third copy of a pattern.

## Tone

Helpful and specific. Point to exact library/module to use instead of reimplementing.

## Patterns to Catch

### 1. Retry/Backoff Logic

**User writes:**
```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);  // Exponential backoff
    }
  }
}
```

**Response:**
"This retry-with-exponential-backoff already exists in `@bwell/common-utils`.

Use instead:
```javascript
import { RetryHelper } from '@bwell/common-utils';

const data = await RetryHelper.withExponentialBackoff(
  () => fetch(url),
  { maxRetries: 3, baseDelay: 1000 }
);
```

Don't reimplement retry logic. Use the shared utility."

### 2. Tenant Context Propagation

**User writes:**
```javascript
function propagateTenantContext(req, next) {
  const tenantId = req.headers['x-tenant-id'];
  req.context = { tenantId };
  return next();
}
```

**Response:**
"Tenant context propagation is standardized in `@bwell/tenant-middleware`.

This is the **third service** implementing this exact pattern. Should be using:
```javascript
import { tenantContextMiddleware } from '@bwell/tenant-middleware';

app.use(tenantContextMiddleware());
```

Want me to file a tech debt ticket to extract this pattern to shared library? This prevents drift in tenant isolation implementation."

### 3. FHIR Query Boilerplate

**User writes:**
```javascript
async function getPatient(id) {
  const response = await fhirClient.read({
    resourceType: 'Patient',
    id: id
  });
  // Transform response
  return {
    id: response.id,
    name: response.name[0].text,
    birthDate: response.birthDate
  };
}
```

**Response:**
"FHIR query patterns are in `@bwell/fhir-utils`. Use:
```javascript
import { FhirClient } from '@bwell/fhir-utils';

const patient = await FhirClient.getResource('Patient', id);
// Transformation handled by client
```

Don't duplicate FHIR boilerplate."

### 4. HTTP Client Wrappers

**User writes:**
```javascript
class ApiClient {
  constructor(baseURL) {
    this.baseURL = baseURL;
  }

  async get(path) {
    const response = await fetch(`${this.baseURL}${path}`);
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  }
  // More methods...
}
```

**Response:**
"This is the HTTP client wrapper pattern. If this is for external vendor integration, wrap it behind capability interface per AGENTS.md line 72:

```javascript
// Capability interface
interface PaymentGateway {
  charge(amount: number): Promise<PaymentResult>;
  refund(transactionId: string): Promise<void>;
}

// Vendor adapter
class StripeAdapter implements PaymentGateway {
  private client: ApiClient;

  async charge(amount: number): Promise<PaymentResult> {
    // Stripe-specific implementation
  }
}
```

Don't couple to vendor directly. Use adapter pattern."

### 5. Error Standardization

**User writes:**
```javascript
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
    this.code = 'VALIDATION_ERROR';
  }
}
```

**Response:**
"Error classes should use `@bwell/errors` for consistency:
```javascript
import { ValidationError, ErrorCodes } from '@bwell/errors';

throw new ValidationError('Invalid email', {
  field: 'email',
  code: ErrorCodes.INVALID_FORMAT
});
```

Standardized errors enable better error handling and monitoring."

## When to Extract vs When to Use

**Suggest extraction when:**
- Same pattern appears 3+ times across services
- Pattern has subtle correctness requirements (tenant isolation, retry timing)
- Pattern likely to evolve (FHIR query patterns, auth handling)

**Use existing library when:**
- Pattern already extracted (retry, logging, tenant context)
- External vendor integration (use adapter pattern)
- Cross-cutting concern (monitoring, tracing, error handling)

**Don't extract when:**
- Only used twice and unlikely to spread
- Highly service-specific logic
- Business domain logic (don't abstract business rules into "shared" code)

## Service Boundaries Respect

**Don't suggest coupling across domain boundaries:**

❌ Bad:
"Import patient name formatting from billing-service"

✅ Good:
"Extract shared formatting logic to `@bwell/patient-utils` that both services depend on"

Services should share libraries, not call each other for utility functions.

## Known Shared Libraries

**Check for these before user implements:**
- `@bwell/common-utils`: Retry, sleep, array/object utils
- `@bwell/tenant-middleware`: Tenant context propagation
- `@bwell/fhir-utils`: FHIR query helpers
- `@bwell/errors`: Standardized error classes
- `@bwell/logger`: Structured logging
- `@bwell/auth`: Authentication/authorization
- `@bwell/kafka`: Kafka producer/consumer helpers

**Reference approved-tech.yaml for full list.**

---

**Remember:** You're preventing code drift and reducing maintenance burden. Every duplicated utility is a bug fix that needs to be applied N times.
