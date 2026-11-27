# Filter `Group.member` and `Group.quantity` in the response for patient-scoped tokens

## Status

Proposed. Not reviewed or agreed by the FHIR team or EA. Ticket: DCON-6603.

**Scope notes:**
- This ADR decides *where* and *how* the returned `Group` is narrowed for a caller holding a
  `patient/` scope, and what `Group.quantity` returns. It changes the response only; the stored
  resource is never modified.
- It is not an FDR. No resource, profile, extension, binding or stored structure changes. If the
  FHIR SME considers a `quantity` that differs from the stored value a data-semantics change, that
  one decision moves to an FDR (see Open items, O1).
- A change to what a public API returns is flagged for EA (see Open items, O2).
- Labels used below: **[CODE]** read in source on `main` at `dfcebd448`; **[UNVERIFIED]** not yet
  confirmed, listed in Open items with an owner. Nothing here was run against a live server and no
  count below is measured.

## Context and problem statement

A patient-scoped token reading or searching `Group` receives the full `Group.member` list, which
holds references to patients other than the token's own.

What already works, **[CODE]**:
- `Group` is patient-filterable. `patientFilterMapping` maps it to `member.entity.reference`
  (`src/fhir/patientFilterManager.js`), so a patient-scoped caller only *finds* Groups whose
  `member.entity.reference` matches the caller's resolved patient ids (proxy patient plus
  `Person.link`-expanded Patients, `PatientScopeManager.getPatientIdsFromScopeAsync`, recursion
  capped at 4). A Group that does not include the patient is not returned (the "no members, or
  access denied" case in the ticket is already the "not found" case).
- That filter selects *which Groups* are returned. Nothing narrows the `member` array of a Group
  that is returned.

Three storage shapes exist for a Group's roster, **[CODE]**:
1. Inline `member[]` in MongoDB (the default).
2. ClickHouse-tracked. With the `USE_EXTERNAL_STORAGE_HEADER` request header,
   `GroupMemberEnrichmentProvider` deletes `member` and sets `quantity` to the **full** active
   member count from ClickHouse. Without the header the inline array is returned.
3. "Extended" (`_extended: true`). The roster lives in `GroupMember_4_0_0`; `member[]` does not
   exist on the live document (`src/utils/mongoGroupExtendedTag.js`).

Precedent for narrowing a returned resource without touching storage: `CompositionSectionFilterEnrichmentProvider`
removes sensitive sections for delegated users from already-fetched resources, using
`enrichmentContext` (`{ userType, actor }`), **[CODE]**.

### Decision drivers

- A patient token must never receive another patient's member reference, or a count that reveals
  the group size.
- Tenant isolation does not change: the existing patient filter and access-tag branches stay as
  they are.
- Every return path is covered: read, vread, search, history, `$everything`, `$graph`, GraphQL v1
  and v2. `review.md` treats a path that skips a gate as a tenant-isolation bug.
- User and system tokens are unchanged.
- Cost per read stays bounded for large Groups.

## Considered options

### Part 1: where to filter

**Option A: enrichment provider, after fetch (selected).** A new
`GroupMemberPatientScopeFilterEnrichmentProvider`, registered with the other enrichment providers,
copies the Group and keeps only `member` entries whose `entity.reference` resolves to one of the
caller's authorized patient ids. It runs only when the caller is patient-scoped for `Group`.
- Pro: same pattern as `CompositionSectionFilterEnrichmentProvider`; operates on a copy, so the
  stored document and any shared cached object are untouched; one place for every path that runs
  enrichment.
- Con: the whole `member[]` is loaded from MongoDB first; the filter is in memory. Enrichment has
  to be confirmed on every path (O3), and the context has to carry the resolved patient ids (O4).

**Option B: filter inside the MongoDB query (rejected).** A projection or aggregation `$filter`
on `member`.
- Pro: the full array never leaves the database.
- Con: `{ member: { $elemMatch } }` projection returns only the *first* matching element, which is
  wrong when a token resolves to several linked patients. Correct behavior needs an aggregation
  pipeline instead of `find`, which touches the query path every operation shares. Large change on
  the most security-sensitive code in the repo for a Group-only need.

**Option C: filter in the response serializer (rejected).** `fhirResponseWriter` only serves REST
responses; GraphQL builds responses elsewhere, so GraphQL would need its own copy. Two
implementations of an access rule is how a path gets missed.

**Option D: deny patient tokens access to `Group` entirely (rejected).** Removes the leak and the
feature. The patient filter exists for `Group`, so patient tokens are expected to read it today;
no consumer inventory was done (O2), so this is a breaking change on an unknown set of clients.

### Part 2: what `Group.quantity` returns to a patient token

**Option Q1: leave the true count (rejected).** Reveals the group size, which the ticket forbids.
Under ClickHouse mode this is the current behavior.

**Option Q2: set `quantity` to the number of `member` entries returned (selected).** `member` and
`quantity` then agree, so a client that reads `quantity` and `member.length` sees one consistent
view. When the response carries no `member` array (ClickHouse header mode, or an extended Group,
which the patient filter already excludes, see O5), `quantity` is **omitted**, not set to a count,
because the count of the patient's own memberships would need an extra ClickHouse query per
Group and the field is `0..1`.

**Option Q3: always omit `quantity` for a patient token (rejected).** Safe, but drops a
consistent value a client can use when the filtered `member` is present, and changes the response
shape more than Q2 for the common inline case.

**Option Q4: round or bucket the count (rejected).** Still leaks size, and a count that agrees
with nothing in the response is the inconsistency the ticket asks us to avoid.

### Part 3: what counts as "authorized to see"

A member entry is kept when its `entity.reference` resolves to a patient id in the set the token
already resolves for the existing filter (own proxy patient and linked Patients). Everything else
is dropped, including non-Patient members (a Group of Practitioners or Devices). Reusing the same
resolved set means the filter cannot disagree with the query filter about who the caller is. The
reference forms (`Patient/<id>`, `Patient/<uuid>`, `Patient/person.<uuid>`) are normalized the same
way the query path normalizes them (O6).

## Decision outcome

Option A for where, Q2 for `quantity`, the Part 3 rule for membership.

Behavior:

| Caller | `member` | `quantity` |
|---|---|---|
| User, system, or admin token (no `patient/` scope for `Group`) | Unchanged | Unchanged |
| Patient-scoped, Group contains the patient, inline roster | Only entries for the caller's patient ids | Number of entries returned |
| Patient-scoped, Group contains the patient, ClickHouse header mode | Absent (as today) | Omitted |
| Patient-scoped, Group does not contain the patient | Group is not returned (existing filter) | n/a |
| Mixed token (`patient/*` plus `user/*`) | Follows the existing rule: only `patient/` scopes are evaluated for a patient-filterable type | Follows `member` |

Paths covered: read, vread, search, history, `$everything`, `$graph`, GraphQL v1 and v2, bulk
export of a Group (see O3). The filter applies to the copy that is returned; no write path
changes.

### Write-back clobber

A client that reads the filtered Group and PUTs it back would replace the stored roster with the
filtered one. **[UNVERIFIED]** whether a patient token can write `Group` (O7). If it can, the
write path has to reject a `member` field it did not previously hold, or reject patient-scoped
`Group` writes. The "stored resource never modified" requirement is only met if this is closed.

## Feasibility and cost

No Group size distribution has been measured (O8). Inputs that exist today:
- Inline `member[]` is capped near 20,000 entries by MongoDB document size, per the pending
  `FDR: Group Persistence` (HEL). Larger cohorts use the extended or ClickHouse shapes.
- The authorized id set `k` is the proxy patient plus linked Patients; recursion is capped at 4
  levels. `k` is expected to be small (single digits), not measured.

Per-read cost of Option A, inline roster, with `m` members and `k` authorized ids:
- Build a `Set` of the `k` ids once per request, not per Group: O(k).
- One pass over `member[]`: O(m) `Set` lookups. At the 20,000 ceiling that is 20,000 lookups per
  Group; expected to be low milliseconds, to be measured (O8). The array is already loaded by the
  existing query, so no extra database round trip.
- Search page of `p` Groups: O(p × m). History of `v` versions: O(v × m).
- Memory: the copy holds at most `k` entries after filtering, so the filtered copy is small even
  when the source array is large.

The cost that does not go away under A is loading `m` entries from MongoDB for a response that
returns about `k`. That cost exists today (the full array is returned), so A makes no read heavier
at the database and makes the response smaller. Option B would remove it at a cost described
above.

## Tenancy

- The existing branch is unchanged: a patient-scoped caller requesting a patient-filterable type
  gets identity-graph reachability, not access-tag filtering (`resource-authorization.md` §5). This
  ADR adds a response filter after that and removes nothing from it.
- The filter keeps only ids the existing resolution produced. It cannot widen access: if
  resolution returns nothing, the filter returns zero members.
- `Person.link` crossing tenants is intentional (`resource-authorization.md` §12), so "linked
  patients" can legitimately belong to another tenant's owner tag; the filter does not add a tenant
  check of its own and must not, because it would diverge from the query filter.
- Required tests: a patient token cannot see another tenant's or another patient's member
  reference in read, vread, search, history, `$everything`, `$graph`, GraphQL v1 and v2.

## Consequences

Positive:
- One filter, same pattern as an existing provider, covering the enrichment paths.
- No change to storage, query construction, or other callers.
- `quantity` and `member` agree for patient tokens.

Negative:
- `quantity` for a patient token is no longer the group size. A client that used it as a size
  (for example "patients in this cohort") breaks silently. Consumer inventory is open (O2).
- The filter is only as complete as the list of paths that run enrichment (O3).
- Adds a branch to a hot response path for every Group in every response; cost is the O(m) pass
  above.

Mitigations: a feature flag defaulting off for the first release; a regression test that fails if a
new Group-returning path skips the provider.

## Open items

| # | Item | Owner |
|---|---|---|
| O1 | Does returning a `quantity` that differs from the stored value need an FDR? | FHIR SME |
| O2 | Consumers of `Group.quantity` and `Group.member` under patient tokens; EA Tech Design Review needed for a public response change? | DCON owner, EA |
| O3 | Confirm `read`, `search`, `history`, `$everything`, `$graph`, bulk export and GraphQL v1/v2 each run enrichment on Group; `history.js` calls specific providers, not the manager, so the new provider has to be added there explicitly | Implementer |
| O4 | Confirm `enrichmentContext` can carry the resolved patient id set (today `{ userType, actor }`); avoid re-resolving per Group | Implementer |
| O5 | Confirm an extended Group (no `member[]`) is excluded by the `member.entity.reference` patient filter, and whether any patient token reaches it | Implementer |
| O6 | Reference normalization: `Patient/<id>`, `<uuid>`, proxy `person.<uuid>` against stored `member.entity.reference` | Implementer |
| O7 | Can a patient token write `Group`? If yes, close the write-back clobber | Implementer, security |
| O8 | Measure Group size distribution (p50, p99, max `member` length) per shape, and the in-memory filter time at the maximum | Implementer |

## Test plan

Synthetic data only, no real identifiers.
- Parameterized unit tests for the provider: no `member`; patient in `member`; patient absent;
  several linked patients; non-Patient members; `contained` Groups; `quantity` present and absent.
- Integration, one per path (read, vread, search, history, `$everything`, `$graph`, GraphQL v1 and
  v2): a patient token gets only its own entry and a matching `quantity`; a user or system token gets
  the full list; the stored document is unchanged after the read.
- Cross-patient and cross-tenant leakage cases in each of those paths.
- ClickHouse header mode: `quantity` omitted for a patient token.

## References

- `docs/resource-authorization.md` §5 (patient-scoped tokens), §12 (known gaps); `review.md`
- `src/fhir/patientFilterManager.js` (`Group: 'member.entity.reference'`)
- `src/enrich/providers/groupMemberEnrichmentProvider.js`,
  `src/enrich/providers/compositionSectionFilterEnrichmentProvider.js`
- `src/utils/mongoGroupExtendedTag.js`
- Pending FDRs in Confluence (HEL): Group Persistence, Groups/Cohorts
