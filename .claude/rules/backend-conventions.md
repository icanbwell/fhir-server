---
paths:
  - "kill_the_clipboard_scanner/**/*.py"
---

# Backend Coding Conventions

## Statelessness (multiple workers)

The app runs as **multiple replicas/pods** behind a load balancer, and consecutive
requests from the same client can land on different workers. **All code MUST be
stateless** — never keep request/session/tenant data in process memory.

- **No in-memory stores for app data.** Do not stash data in module-level globals,
  class attributes, or instance caches and read it back on a later request. The
  pod that wrote it is usually NOT the pod that serves the next request.
  (Real bug this caused: `dev_shl_router` stored a minted JWE in a module global;
  the follow-up fetch hit another pod and got nothing → `SHL_DECRYPT_FAILED`.)
- **Shared state lives in shared backends only** — MongoDB (Beanie) for data,
  the IdP (Descope) for identity/tenancy. If two requests must see the same thing,
  it goes in a shared store, not memory.
- **Prefer self-contained / recomputable designs** over server-side session state:
  carry what's needed in the token, the URL, or the request, or recompute it from
  inputs (a pure function), so any worker can serve any request.
- **In-memory caching is only acceptable for immutable, idempotently-recomputable
  reference data** where every pod independently derives the *same* value (e.g. an
  OIDC discovery document). Never cache per-tenant or per-request data.
- **Cross-pod coordination (rate limits, locks, counters) needs a shared backend**
  (e.g. Redis). A bare in-memory counter is per-pod and effectively ×N. The slowapi
  limiter is in-memory today, so `RATE_LIMIT_*` are per-pod — a known limitation.
- No reliance on sticky sessions, local disk for shared artifacts, or background
  state that assumes a single process.

## Keyword-Only Arguments

All function and method parameters (except `self`/`cls`) MUST be keyword-only. Use `*` as the first parameter:

```python
def register(*, mcp: FastMCP[Any], scan_pipeline: ScanPipelineService) -> None: ...
```

Exceptions:
- Protocol/interface implementations matching external library signatures
- Overridden methods from parent classes
- Framework-required signatures (FastAPI endpoint parameters)

## IoC Container

Dependencies are registered as singletons in `KtcContainerFactory` and resolved at runtime via `get_container().resolve(Type)`. Do not construct shared dependencies directly.

## Environment Variables

All environment variable access must go through the typed `EnvironmentVariables` class. Do not scatter `os.environ.get()` / `os.getenv()` calls through business logic — add a property to the class instead.
