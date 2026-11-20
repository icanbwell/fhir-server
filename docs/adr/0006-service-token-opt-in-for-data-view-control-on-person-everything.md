# Service-Token Opt-In for Data View Control on Person $everything

## Status

Accepted

**Scope notes:**
- Covers `Person/{id}/$everything?_applyDataViewControl=true` only: how a service reading on a
  user's behalf asks for that user's `dataConnectionViewControl` block. User tokens are
  filtered on every read path regardless; this ADR doesn't change that.
- No Tech Design Review: the change is additive, internal callers only, and can only remove data
  from a response.
- Service tokens without the parameter are unchanged. Pipelines, the delete handler and account
  deletion need the full record, so the server never filters a service token on its own.

## Context

A user can hide resources from a data connection with a `dataConnectionViewControl` Consent. The
server applies it to reads made with the user's own token. Some b.well services build what the
user sees from a service (client-credentials) token instead. The composition service is the first:
it reads a user's record with `Person/{id}/$everything` and writes the user's summary
Compositions. Without the block, a summary can show a resource the user hid.

The service needs a way to say "apply this Person's block to my read". Three questions had to be
answered:

1. How the service asks: a query parameter or a header.
2. Whose block applies: which Person the Consent is looked up for.
3. What happens when the block can't be determined.

## Decision

### 1. A query parameter, `_applyDataViewControl=true`

It sits with the other `$everything` controls (`_includeHidden`, `_includePatientLinkedOnly`, and so
on) and goes through the same handling:
- It is listed in `SPECIFIED_QUERY_PARAMS`, so `Prefer: handling=strict` accepts it.
- Only a Person `$everything` read (GET) uses it. On any other REST operation, including `DELETE`
  `$everything`, a service token that sends it gets a 400 (`FhirOperationsManager.getParsedArgsAsync`
  and `getEverythingViewControlSubject`), because accepting it there would return an unfiltered
  record to a caller that asked for a filtered one, or delete resources it asked to have hidden.
  User tokens are always filtered, so a valid value changes nothing for them.
- The value is parsed strictly, for every token: `true` or `1` applies the block, `false` or `0` does
  not, and anything else (`yes`, `on`, an empty value, a repeated key) is a 400. A misspelling is
  never read as "no opt-in", which would return an unfiltered record.
- `/mcp` is not covered. Its `fhir_search` tool reads free-form `filters` and never goes through
  `getParsedArgsAsync`, so the parameter does nothing there. MCP is off by default and no service
  caller uses it for this; a caller that needs the block on MCP needs its own decision.
- It is in `$everything`'s list of uncacheable parameters, so an opt-in response is never stored in
  or served from the `$everything` cache.
- It shows up in the request URL in access logs and traces. It is a flag, not an identifier, so
  this logs no PHI.

### 2. The block of the Person in the URL, one Person per request

The Person whose block applies is the one being read: `{id}` in `Person/{id}/$everything`. The
request carries no second identifier, so there's nothing that could disagree with the URL.
- The Person is read through the caller's access filter. A Person the token can't see is a 404,
  identical to a Person that doesn't exist, so the parameter can't be used to probe for Persons.
- The Consent is looked up for that Person's uuid, and only if the Person's owner is enrolled
  (`CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL`), as for a user.
- More than one Person id with the parameter is a 400 OperationOutcome. The composition service
  calls one Person at a time, and one Person keeps the owner check and the Consent lookup simple.
  Multi-Person support can be added if a caller needs it.
- On Patient `$everything` the parameter is a 400. Asking for a block we can't apply is an error,
  not a silent unfiltered response.
- A source id that matches more than one visible Person is a 400 asking for the Person uuid.
- The Consent is keyed on the Person in the URL, which is the user's own Person (the one a user token
  carries). A Person that links to other Persons is not walked for their Consents.
- The Consent is searched through the caller's access filter, so the block applies only if the
  Consent carries an access tag the caller can see. For an enrolled owner, a caller whose access
  scopes don't cover that owner gets a 403 instead of an unfiltered record. This assumes a
  `dataConnectionViewControl` Consent always carries its Person's owner tag; a Consent tagged for
  another owner would look like no Consent to a tenant-scoped caller.
- User tokens ignore the parameter: they are already filtered by their own Person.

In code, the subject is a value object, `ViewControlSubject` (`src/utils/viewControlSubject.js`),
built either from the token (user) or from the URL Person (this opt-in). The view-control lookup
is keyed on it, so the two can't be confused within a request.

### 3. Fail closed

For an opt-in request, the Person and the Consent are loaded before `$everything` starts writing the
response. The caller's read scope is checked first, so a token that may not read the Person gets a
403 whether or not the Person exists. If a lookup fails (the Person has no owner tag, or the Consent
search errors), the request fails with an HTTP error and returns no data, and the failure is logged
as an operation failure. A caller that asked for the block never gets an
unfiltered record because a lookup failed.

### 4. Only `active` Consents apply (a deliberate policy change)

The Consent lookup, for user tokens and for this opt-in alike, searches `status=active`. Before
this change it had no status filter, so a view control Consent hid data whatever its status. Now a
Consent set to `inactive`, `draft`, `rejected` or `entered-in-error` hides nothing.

This is intended, not a side effect of the index fix:

- It matches the other Consent lookups (PROA/IAS, delegated actor), which also apply only active
  Consents.
- It lets a block be withdrawn by changing the Consent's status.
- It lets the query use the `{status, patient._uuid}` index instead of scanning the collection.

The delete handler writes `status: "active"`, so existing blocks keep working. A production count on
2026-11-12 found only active view control Consents (none `inactive` or `draft`), so no current data
changes.

## Consequences

### Positive

- The composition service gets the user's block with one parameter, on the call it already
  makes.
- Nothing changes for callers that don't send it, including every pipeline and deletion flow.
- The parameter can only take data away, and an error never returns more data than a success.

### Negative

- This is one more parameter that a caller has to remember. A service that forgets it gets the full
  record, as before.
- Failure behaviour differs from the user path. A user's `$everything` starts streaming before
  its lookup runs, so a user's lookup failure is a 200 with an error OperationOutcome and no
  clinical data, while an opt-in failure is an HTTP error.
- One Person per request. A caller with several Persons makes several calls.
- The Consent lookup runs under the caller's own scope, so a Consent the caller's query can't match
  is not found and its block is not applied. That happens for a service token when the Consent's
  access tag is outside the token's access codes, and for a patient-scoped user when the Consent
  carries the restricted confidentiality tag. The data the user hid is returned, with no error.
  Today's enrolled data has no such Consent, but nothing prevents one being written. A write-time
  guard, so that a Consent carries its Person's tags, is the intended follow-up.

### Mitigations

- The parameter is documented in `readme/patientEverything.md`, and its name is shared with the
  composition service's team.
- Integration tests cover on and off, enrolled and non-enrolled owners, an invisible Person,
  multiple ids, lookup failure, a missing owner tag, strict handling, Patient `$everything` and
  user tokens.

## Options Considered

### Option 1: A request header, such as `Prefer: apply-data-view-control` (Rejected)

The server already reads `Prefer` for `global_id` and `handling`. A header keeps the URL unchanged,
but the `$everything` cache key generator (`patientEverythingCachekeyGenerator.js`) only looks at
query parameters. An opt-in sent as a header would share a cache entry with unfiltered reads unless
the generator learned about headers. It also doesn't show in the request URL in logs. `$everything`'s other result-shaping
controls are query parameters, so a header would be the odd one out.

### Option 2: Name the user in a header or a token claim (Rejected)

A header (for example "on behalf of Person X") or a claim in the service's token could name whose
block applies. Either one is a second identifier next to the URL, so the two could disagree, and the
server would have to decide which wins and check that the caller may act for that Person. Keying on
the URL Person avoids both: the caller is already reading that Person, through its own access
filter.

### Option 3: Filter every service token by the Person being read (Rejected)

This needs no caller change, but pipelines, the delete handler and account deletion must see the
full record. Filtering would silently drop data from those flows.

### Option 4: The service exchanges for a user token (Rejected)

The user path would apply unchanged, but backend services would need to obtain user tokens,
a new auth flow for an internal read. Out of proportion to the need.

### Option 5: A query parameter keyed on the URL Person, one Person per request, failing closed (Selected)

As described under Decision.

## References

- `readme/patientEverything.md`, section `_applyDataViewControl`
- `readme/patientDataViewControl.md`
- `src/operations/everything/everythingViewControlSubject.js`: which Person applies, and the 400s
- `src/utils/patientDataViewControlExclusion.js`: the lookup, keyed on the subject
- `src/utils/patientDataViewController.js`: `findPersonAsync` and `getConsentAsync`

## Related Decisions

- Multi-Person support for the parameter, if a caller needs it
- View control on `$graph`, `$summary` and PROA reads, which are handled separately
- The composition service adopting the parameter, which is tracked in that service's repository

---

**Date**: 2026-11-11
**Authors**: Tyler Hackbarth
**Status**: Accepted
