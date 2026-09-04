---
paths:
  - "**/*test*.py"
  - "**/test_*.py"
  - "**/*_test.py"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*Test.java"
  - "**/tests/**"
  - "**/test/**"
  - "**/__tests__/**"
---

# Testing

### Testing Is Part of the Change
Every behavioral change ships with tests. Tests are not a follow-up task.

### Parameterized Tests
Use parameterized tests (Jest `test.each`, pytest `@pytest.mark.parametrize`, JUnit `@ParameterizedTest`) for any function with more than two input variations. Data-driven test cases, not copy-pasted test methods with one value changed.

### Arrange-Act-Assert
Structure every test with clear setup, execution, and verification phases. One behavior per test. Multiple asserts are fine when they verify that single behavior.

### Mock Only at External Boundaries
Mock external services, databases, and third-party APIs. Do not mock internal implementation details. If you need extensive mocking to test a unit, the design is too coupled - fix the design, not the test.

### Test Error Paths
Test failure modes, error handling, retries, and edge cases explicitly. Do not test only the happy path.

### Contract Tests at Boundaries
API request/response shapes, event schemas, and external integration contracts must have contract tests. When you change a public API or event schema, update the contract test in the same PR.

### Tenant Isolation in Integration Tests
Integration tests must verify that tenant boundaries are enforced. Cross-tenant data leakage is a correctness bug, not a nice-to-have test case.

### Test Behavior, Not Implementation
Assert on what happened, not how it happened internally. Tests should survive refactoring of internals without breaking.