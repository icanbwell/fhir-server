# QUAL-73: Systematic security test matrix for tenant and user isolation

## Summary

| | Count |
|---|---|
| New tests running on every PR | 176 |
| Gaps identified, tracked as failing tests | 12 |
| Tests written that cannot run without credentials | 24 |
| Test files added | 12 |

Coverage is derived from the access model rather than from a list of prior tickets. The suites enumerate every caller type against every resource visibility class through every endpoint that returns data. For each (endpoint, caller) pair the test asserts the **exact set of resource ids returned**, so both over-sharing and under-sharing fail on the same assertion.

## New suites

`src/tests/security/matrix`, 176 tests, all passing.

| Suite | Coverage |
|---|---|
| `read_matrix` | Every read endpoint against every caller and tag combination: read by id, search, `_security` search, `$everything` on Patient and Person, `$graph`, `$summary`, `_history`, prior versions, `_include`, `_revinclude`, chained and `_has` parameters, GraphQL v1 and v2, proxy patient |
| `write_matrix` | `PUT`, `POST`, `PATCH`, `DELETE`, `$merge`. Tag forgery, cross-tenant overwrite with version comparison, protected fields, forged `Person.link` |
| `traversal_matrix` | Link shapes: cross-owner hop, same-owner hop, 4-hop chain, cycle, self-link, dangling target, all assurance levels, two persons sharing an identifier value with no link between them |
| `consent_matrix` | 7 consent states, batch-boundary requests, scoped consent lookup, revocation and deletion |
| `oracle_matrix` | Existence disclosure by status code, response body, response headers and elapsed time, across 7 read paths and 4 write mechanisms. Derived-id probing on source id and internal uuid |
| `auth_matrix` | 9 malformed or unsigned token shapes against 5 paths, scope parsing, error-body content, search-parameter injection |
| `mutation_matrix` | Visibility follows a tag change, link removal, consent change or delete, on every route |

Every assertion that a record is withheld is paired with an assertion that the same record is returned to an authorized caller. Without the pair, a test passes when the record is absent, a link is broken, or a fixture has a typo, and continues to pass with all access control removed.

## Gaps identified

12 gaps, in `src/tests/security/matrix/findings.bugs`. Each states the target secure behavior and fails until the behavior matches it. Each is paired with a control test that passes, so a red result indicates the gap rather than a broken fixture. Currently 24 target-state assertions fail and 19 control assertions pass.

| # | Current behavior | Rule |
|---|---|---|
| 1 | A same-owner person-to-person link is traversed. Traversal proceeds 4 hops without comparing owners, and both records carry the same tenant tag, so the access filter does not exclude the result | IDG-2 |
| 2 | `Person.link.assurance` is not read. A `level1` match merges identically to `level4`, and a link with no assurance value is treated as certain | IDG-7 |
| 3 | A consent whose period ended in 2020 still unlocks upstream records. Only `status` is evaluated, and no process updates it when the period elapses | CL-1 |
| 4 | A consent whose period begins in 2090 already unlocks upstream records | CL-1 |
| 5 | Repointing the consent's authorizing actor at a different, non-existent person leaves the consent functional. It is matched on patient and owning client, not on the authorizing party | CL-1 |
| 6 | A client with write scope can create a consent naming itself as recipient of upstream data, and it is honored. Combined with gap 5, a client able to write a Consent could unlock upstream records for any patient it can name | SAE-6 |
| 7 | Naming another tenant's person id on a plain search executes the traversal. The tag filter still applies, so no unauthorized record is returned, but the caller can determine which of its own readable records are linked to that person. The owner check runs only for `$everything` on a GET | IDG-5 |
| 8 | Narrowing a record's access tags withholds the current version but not version 1 | SAE-1 |
| 9 | An end-user token carries a wildcard access scope, so no tenant filter applies and patient-scope expansion traverses into PROA and IAS records with no consent present. Needs a product decision on whether a user is entitled to their own upstream records | SAE-3 |
| 10 | A token with `token_use: id`, an absent `token_use`, or `token_use: refresh` is accepted as an access token | AUTH-1 |
| 11 | `_sort=$$$` returns 500 rather than a 4xx | SAE-4 |
| 12 | Tenant A writing to tenant B's source id creates a second record sharing that id. B's read by that source id then returns 400, and an `_id` search stops returning it. The record persists and remains in an unfiltered listing, but source-id integrations would fail | SAE-5 |

`jest.config.js` quarantines `findings.bugs` so tracked work does not block CI. The matrix suites are not quarantined and do run.

## Changes to existing suites

**`proa_patient_cross_tenant_isolation`** (directory renamed for clarity). The `Person.link` targets omitted the `|sourceAssigningAuthority` suffix, so `ReferenceGlobalIdHandler` derived the target uuid from the parent's authority and the links resolved to ids that do not exist. Three IDG-5 tests asserted that a client did not receive a PROA patient that was unreachable by every caller, including a wildcard-scope caller, so they would have passed with all access control removed. Verified with a full-access probe, which returned 3 of 7 seeded resources. With the suffix added, the wildcard caller returns all 7 and the scoped caller still returns none of the upstream records, so the isolation is genuine and the test now demonstrates it. A permanent reachability control fails if the fixtures regress.

**`ias_tefca_isolation`** gains two reachability controls and validates every `$merge` response entry. `toHaveMergeResponse` validates only index 0 of an array, so a fixture that failed to persist still appeared seeded.

**`end_user_cross_user_isolation`** uses the production token scope and claim set, copied from a staging end-user token rather than invented. A vacuous `expect([200, 401, 403, 404]).toContain(status)` assertion is removed, since it admits every possible status. Adds a body-level oracle check and an open-search test.

**`inc331_consent_chunk_isolation`** and **`sae4_write_no_oracle`** are documented as invalid and are not counted as coverage. Batching applies to the top-level requested ids, so a single-person `$everything` produces one chunk and never reaches the chunk-index cache key. Ids are partitioned by owning tenant, so a foreign source id and an unused id both fall into the same create branch and the two responses are trivially equal.

## Tests blocked on service-account credentials

**These 24 tests will not pass until credentials exist.** They are written, committed, and skip when the required environment is absent, so they do not fail CI in their current state. They report as skipped, not passed. No further test code is required; the remaining work is supplying tenant slugs and target record ids. `scripts/security/.env.example` lists every variable.

| Coverage | Exact blocker | Tests | State today |
|---|---|---|---|
| Read isolation across a tenant boundary, through every endpoint in the read matrix | `SA_RO_CLIENT_ID` + `SA_RO_CLIENT_SECRET`, read-only service account scoped to one tenant | 13 | Skipped |
| Existence disclosure on staging data, including a 9-sample response-time comparison | Same read-only client id and secret | 3 | Skipped |
| Write isolation: tag forgery, cross-tenant overwrite, delete, forged links | `SA_RW_CLIENT_ID` + `SA_RW_CLIENT_SECRET`, read/write service account scoped to one tenant | 4 | Skipped |
| `$export` content, polled to completion with the produced files read | Either client id and secret, with export enabled for it | 1 | Skipped |
| Two clients sharing one upstream PROA record | `BRIDGE_A_CLIENT_ID` + secret in each of two tenants | 3 | Skipped |
| End-user cross-user isolation, end to end | `CLIENTKEY` plus email and password for two test users in one tenant. Different identity pool from service accounts, not a service account | 3 | Skipped |
| Identity provider unreachable, verifying the request is refused rather than admitted | Not a credential. Requires egress from the running service to the identity provider to be blocked | 1 | Skipped |

The two-clients-sharing-one-upstream-record case cannot be constructed in narrow integration, because it requires two client tenants referencing one upstream connection. It is the highest-priority property in the plan.

## CI expectations for this PR

`node.js.yml` runs `jest` sharded 12 ways using `jest.config.js`, plus a separate lint job. Expected result: the 176 matrix tests pass, the 12 gaps do not run, and the 24 blocked tests skip.

Verified before opening:

- 176 matrix tests pass under Node 24.14 per `.nvmrc`.
- `eslint` clean across `src/tests/security/matrix`, `src/tests/live`, and every modified suite. 13 `quote-props` and `comma-dangle` errors were found and fixed in `1ac5e179a`; without that the lint job would have failed.
- 24 target-state assertions fail and 19 control assertions pass in `findings.bugs`, confirming each gap is real rather than a fixture error.
- No secrets committed. `scripts/security/.env` and `CLAUDE.local.md` are both covered by `.gitignore` and neither is staged. The staged diff was scanned for token-shaped strings, long hex, `client_secret` and password patterns.

**One assumption the first CI run will validate.** The matrix was verified locally under a substitute Jest config. `src/tests/jestGlobalSetup.js` starts a ClickHouse testcontainer, and the development environment had no container runtime, so `globalSetup` was replaced with one starting only `mongodb-memory-server`. The matrix tests do not use ClickHouse, but under `jest.config.js` they inherit that global setup and depend on it succeeding. `ubuntu-latest` provides Docker and the existing suite passes there, so this is expected to work.

Items to confirm on the first run:

- ClickHouse testcontainer startup succeeds and the matrix files reach execution.
- `testPathIgnorePatterns` matches `<rootDir>/src/tests/security/matrix/findings.bugs/` as a directory entry, so the 12 gaps do not run.
- Shard runtime. The 7 matrix files add roughly 3 to 4 minutes with `--runInBand`, distributed across 12 shards.
- The `mongodb-memory-server` binary download succeeds. The workflow already retries `yarn install` for this reason.

**Pre-existing item, not introduced here.** `test:jest_coverage` and `test:jest_functional` in `package.json` pass `--testPathIgnorePatterns` on the command line, which overrides the list in `jest.config.js`. Under those scripts every quarantined test runs and fails, including the 14 pre-existing quarantined access-control files and the new `findings.bugs`. `node.js.yml` does not use those scripts, so this PR is unaffected, but a coverage build will fail.

## Follow-ups, not in this PR

- Triage the ~153 pre-existing quarantined tests across 14 files. Several coverage gaps are covered by tests that do not execute. Their comment blocks also predate this work and use language that should be brought in line with it.
- 12 areas have no test yet. 5 are blocked on product decisions: guardian and Health Circle access, the IDG-7 identity-match threshold, suppressed sensitive categories, whether an end user is entitled to their own upstream records with no consent present (gap 9), and the revocation timing bound.
- Subscription and webhook delivery is not in this repository and needs a separate plan against the owning service.
- `scripts/security/.env.example` previously contained two test-user email addresses as literal values, committed in `ae3d7111b`. This PR replaces them with empty placeholders. They remain in history and purging requires a branch rewrite.
