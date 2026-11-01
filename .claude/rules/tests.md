---
paths:
  - "src/tests/**"
---

# Test conventions

- Run jest with `--runInBand --forceExit` (shared in-memory MongoDB, lingering handles).
- Unit tests under `src/tests/unit` need `--config jest.unit.config.js`, otherwise jest reports
  "no tests found". Integration tests need Docker.
- Use synthetic data only; never put PHI/PII in fixtures.
- Use `toHaveMongoQuery` before `toHaveResponse` (it mutates the result).
- If a test calls `mockHttpContext()`, await
  `getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId })` after every write
  request (see "Shared request id in integration tests" in CLAUDE.md).
- Override services for tests in `src/tests/createTestContainer.js`.
- Multi-input behavior gets one `test.each`, not copy-pasted tests. Integration tests for access
  paths must cover tenant/security-tag isolation.
