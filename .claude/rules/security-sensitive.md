---
paths:
  - "src/operations/**"
  - "src/strategies/**"
  - "src/middleware/**"
  - "src/queryRewriters/**"
  - "src/dataLayer/**"
  - "src/utils/**"
  - "src/enrich/**"
  - "src/preSaveHandlers/**"
  - "src/fhir/**"
  - "src/graphql/**"
  - "src/graphqlv2/**"
---

# Security-sensitive paths

Changes here can affect access control, tenant isolation, or PHI exposure. Before finishing, read
`review.md` at the repo root and check the diff against it (search/read, Person/Patient link
traversal, writes, OAuth scope/token parsing, request-scoped caching, cross-resource joins).
Never log PHI/PII; confirm access-tag/scope filtering on any new data access path, or say you could
not.
