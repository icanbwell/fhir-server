# Adversarial PR Review — Access Control & Tenant Isolation

## Purpose

This file is a standing checklist for adversarially reviewing every PR to this repo for
cross-tenant / cross-client / cross-user data-access regressions — i.e. could this change let a
service account or user belonging to one client read, infer the existence of, or write data
belonging to another client, another user, or a Person/Patient they are not authorized for.

It is scoped narrowly to the access-control / tenant-isolation / security-model surface. It is
not a substitute for general code review (style, tests, performance) — use the repo's other
review tooling for that.

## How to use this file

For every PR:

0. **Check for sensitive values first (§0)** — this one always applies, regardless of touch point.
1. **Identify touch points** — does the diff touch any of: resource search/read, Person/Patient
   link traversal or expansion, resource write (create/update/merge/patch/remove), OAuth
   scope/token parsing, caching of anything derived from a request, or a join/lookup keyed by an
   identifier shared across tenants (e.g. a source-system patient id, an internal UUID)? If none of
   these apply, the *rest* of this checklist (§1 onward) doesn't apply — say so and stop; §0 still
   applies regardless.
2. **Walk the relevant checklist section(s) below** against the actual diff, not just the PR
   description. Read the surrounding code, not only the changed lines — regressions here are
   usually about what a change *removes or fails to add*, not what's visibly wrong in isolation.
3. **For every candidate issue, construct a concrete attack scenario** before flagging it: name
   the caller (scope, tenant, user vs. service account), the target resource/tenant, and the
   exact request that would trigger it. If you can't state a concrete scenario, say so explicitly
   and mark it lower-confidence rather than omitting it.
4. **Report both ways** — list what you checked and found clean, not only problems found. A
   review that only lists findings is indistinguishable from one that didn't look.

Report findings as:

| Severity | Area | Attack scenario | Recommendation |
|---|---|---|---|

plus a "Checked, no issues found" list of the touch points reviewed.

## 0. Sensitive values in the PR itself

This repo is public. Run this check on **every** PR, regardless of whether it touches any of the
access-control surface below — it's about what the PR *contains*, not what the code *does*.

- Scan the diff, commit messages, and PR/issue description (not just the code) for a real, live
  identifier that shouldn't be publicly visible: an OAuth/Cognito/Okta/Descope pool ID or
  `client_id`, an API key, a secret or token, an internal hostname not already public elsewhere in
  the repo, or any other environment-specific configuration value.
- This applies even when the PR is *about* a security bug. Describing a real vulnerability with
  real identifiers as evidence is itself a disclosure, independent of whether the code fix is
  correct. Use a placeholder (`<pool-id>`, `<client-id>`) or a made-up example value instead, and
  move real values to a private channel (Slack DM, an internal/private repo, a private Jira
  project) if they're actually needed for the discussion.
- This includes values copied in while investigating — from a decoded JWT, another repo's config,
  or a Slack thread. A value already existing somewhere internal doesn't make it safe to paste
  into this public repo.
- If a real identifier already made it into a pushed commit or PR description, closing the PR or
  deleting the branch does **not** remove it: GitHub retains PR commit history (via its internal
  `refs/pull/<n>/head` ref) even after the source branch is deleted, and a closed PR's Commits tab
  and direct commit URLs stay publicly visible. Treat this as urgent: scrub what's actually
  editable (PR/issue body, comments) immediately, and escalate to a repo/org admin — they'll need
  to decide whether the identifier itself should be rotated and whether to ask GitHub Support to
  purge the specific commits from public view.

## 1. The data model (primer)

- **Main Person** — a real human; the cross-tenant hub concept. Every `Person` resource has the
  same shape today; there's no dedicated schema-level marker for this role.
- **Client Person** — one `Person` resource per tenant/client a human has an account with (e.g.
  one for their Samsung account, one for their Walgreens account). Carries an owner tag for that
  tenant.
- **Independent Person** — a `Person` resource created directly from a PROA/IAS connection,
  outside the Main→Client hierarchy. It links straight to a source Patient in its own, separate
  tree rather than hanging off a Main Person.
- **Patient** — one `Patient` resource per data source (health system, payor, pharmacy, lab).
  Patients belong to a *source*, never directly to a client.
- **Main Patient** — a placeholder `Patient` a Main Person may link to directly. It carries no
  PHI/clinical data of its own — it's an anchor record, not a source-of-truth clinical record —
  which is what distinguishes this hop from a Main Person reaching a *real* source Patient.
- **Clinical/other resources** — reference a Patient (or, via the `Patient/person.<id>`
  proxy-patient convention, a Person).
- **Link** — `Person.link` connects Main Person → Client Person → Patient (or, for an
  Independent Person, Independent Person → Patient directly), via an `assurance` (match
  confidence) field only — it does not carry a relationship-type/category. These are the *only*
  hops the data model defines as legitimate, plus one exception: a Main Person may also link
  directly to its own placeholder Main Patient (see above), which carries no PHI. A Main Person is
  currently constrained to link to a single Client Person (a known identity-model gap, not a
  security boundary, and it may be lifted later) — but a link that skips a tier to reach a *real*
  source Patient (one carrying PHI), or connects two resources of the *same* tier (Main ↔ Main,
  Client ↔ Client), is never an intentional relationship. It's a duplicate-record data-quality
  defect and must not be treated as an authorized identity match.
- **Owner tag** (`meta.security`, system `.../owner`) — exactly one per resource; declares the
  authoritative tenant.
- **Access tag(s)** (`meta.security`, system `.../access`) — one or more; declare which
  tenant(s) may read the resource. This is what every tenant-isolation check should ultimately
  be filtering on.

Any query, traversal, or write that doesn't ultimately reduce to "is every access tag on this
resource one the caller is authorized for" is worth a closer look.

## 2. Caller / scope types (primer)

- **Tenant/service-account scope** — authorizes access to resources tagged for that tenant.
- **Resource-type read/write scope** — combined with the tenant scope to determine what's
  allowed.
- **Patient-scoped tokens** — anchored to a specific Person/Patient id, and distinguishable in
  code from tenant/service-account tokens. **A check that branches only on "is this a
  patient-scoped user token" is worth extra scrutiny** — confirm the non-patient-scoped
  (service-account) path still gets an equivalent tenant/access check, rather than skipping it.
- **Admin scope** — typically bypasses tenant filtering by design; changes here need explicit
  reasoning for why the bypass is safe.
- Patient-scope checks and tenant/access-scope checks tend to live in different code paths — a
  PR that adds a new authorization branch should be checked for whether it's mutually exclusive
  with the *other* scope type's check (a common bug shape in multi-tenant systems generally: one
  scope type's caller bypassing the other scope type's filtering entirely because the two checks
  live in an if/else rather than both being required to pass).

## 3. Checklist by touch point

### A. Search / read / query construction

- Does every new or modified query path build its filter through the shared tenant-scoping
  mechanism, rather than querying by a raw internal id/uuid/source-id first and checking access
  afterward? Fetch-then-check-afterward can still leak existence/timing/error-detail through
  response-code differences even when the response body is correctly withheld.
- Is an internal id/uuid ever treated as if it were secret or unguessable? Confirm whether it
  could be derived or brute-forced from other information available to a caller. Any "check by
  exact id" gate needs a real access-tag check behind it, not just id-matching.
- Do all resolvers/query builders (including any GraphQL layer) reuse the same tenant-scoped
  search path, or does any of them construct an independent query outside that shared mechanism?

### B. Person/Patient link traversal & expansion

- Does every resource surfaced through link traversal get the *same* per-resource access-tag
  check it would get if fetched directly by id? Reachability via a link is never itself
  authorization.
- Does a traversal/expansion path apply its access check consistently across every URL form or
  entry point that can reach the same conceptual operation? A fix applied to one entry point does
  not necessarily cover an equivalent one.
- When a traversal step decides whether to follow a link further (e.g., one record pointing to
  another), verify that decision is based on an explicit, intentional relationship the data model
  actually defines — not an incidental attribute the two records happen to share. Two records
  sharing an attribute is not the same as one being an authorized extension of the other, and
  code should not treat it as license to combine their data without confirming that's deliberate.
- Concretely, the *only* legitimate `Person.link` hops are Main Person → Client Person → Patient,
  Independent Person → Patient, and Main Person → its own placeholder Main Patient, which carries
  no PHI (see §1). A link between two resources of the *same* tier (e.g. two Main Persons, or two
  Client Persons), or a Main Person linking directly to a *real* source Patient that carries PHI,
  is always a duplicate-record defect, never an authorized identity match, and traversal must
  treat it as a dead end rather than following it.

### C. Write path (create / update / merge / patch / remove)

- Authorization checks over a multi-valued attribute (like a list of access tags) can require
  either "at least one value matches" or "every value matches," and the correct choice usually
  differs between read and write. Verify which quantifier a given check actually uses, and
  whether it's the right one for what it's gating — getting this backwards in either direction is
  a classic access-control pitfall (too permissive on write, or too restrictive on read).
- If a merge/update path maintains a list of fields a caller cannot override (to protect resource
  identity, versioning, or ownership), verify that list is actually complete for every field that
  could change who is allowed to access the resource. Protected-field lists are easy to leave
  incomplete as a schema gains new security-relevant fields over time — or re-run the access
  check against the fully-merged document before persisting, instead of relying on the list alone.
- Does any internal-field/patch blocklist match on the actual field name (an explicit
  allowlist/denylist), rather than a naming convention (like a prefix character)? A
  convention-based blocklist can be bypassed by any field that doesn't happen to follow the
  convention.

### D. Consent / allow-list caching, and anything request-scoped

- A cache or memoized value derived from a request should be re-derived (or clearly invalidated)
  whenever the scope of what's being asked for changes during that request's lifecycle — not just
  computed once at the start and trusted for the rest of it. If a single logical request can be
  processed in multiple internal steps that each have a different effective scope, confirm the
  cache can't quietly carry an earlier step's answer into a later, differently-scoped step. Treat
  any new or modified per-request cache as high-scrutiny by default.
- When an authorization-derived filter ends up matching nothing, verify the code treats that as
  "return nothing," not "have no filter, so return everything." A function that represents "no
  restriction" and "no matches" the same way is an easy way to fail open by accident — confirm
  the emptied-filter case explicitly rather than assuming it's handled.
- Is any of this state held on a process-wide singleton service? If so, confirm request-scoped
  data is being passed in per-call, not accidentally cached on shared instance state across
  requests/tenants.

### E. Cross-tenant joins on a shared identifier

- Any join/match on an identifier that exists independent of tenant (e.g. a source-system patient
  id, an MRN, a shared upstream identity key) — does the query also include a tenant/client
  discriminator in the join condition itself, not just in a later filter step? Two tenants
  sharing the same underlying real-world patient at a health system is a normal, expected case —
  the join must not let them see each other's records, connection status, or other metadata as a
  side effect.

## 4. Maintenance

- If review under this checklist surfaces a new risk pattern worth remembering, add it to the
  relevant checklist section above so future reviewers benefit.
- Keep this checklist's language general and pattern-based rather than tied to one specific
  instance, so it stays useful as the codebase evolves.
