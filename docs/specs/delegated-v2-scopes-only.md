# Delegated tokens accept only SMART v2 letter scopes

## Intent

A delegated token (a RelatedPerson acting for a patient, carrying an `act` claim) is minted with
SMART v2 letter scopes (`patient/Observation.rs`, `access/client.rs`). Today fhir-server still honors
the v1 suffixes (`.read`, `.write`, `.*`) on such a token, and v1 `.write` means create, update and
delete together. The delegated model never grants delete, so a delegate must be evaluated on letters
only. This change makes a delegated token carry nothing but v2 letter scopes into the request path.

Non-delegated tokens are not touched.

## Non-goals

- No change to how v2 letters are parsed or enforced (already done behind
  `ENABLE_SMART_V2_CRUDS_SCOPES`).
- No change for Organization actors (see Decisions).
- No change to the token contents. Minting letter scopes is the identity provider's side.

## Approaches

1. **Filter the scope string once, at login, in `AuthService.processUserInfo`.** Every consumer reads
   `req.authInfo.scope` / `requestInfo.scope`, so a filtered string reaches all of them. One place,
   nothing downstream changes. **Chosen.**
2. Teach each parser (`ScopesManager`, `ScopesValidator`) to reject v1 for delegated callers. Needs the
   caller type threaded into about five call sites and is easy to miss one. Rejected.
3. Filter in `getFieldsFromToken`. It runs before the `act` claim is evaluated, so it cannot tell a
   delegate from anyone else. Rejected.

## Design

- New flag `ENABLE_DELEGATED_V2_SCOPES_ONLY` (`configManager.enableDelegatedV2ScopesOnly`), default off.
- New pure function `filterToV2LetterScopes(scope)` in `src/operations/security/smartScopeParser.js`.
  It splits the string on spaces and drops a token when its prefix (`patient`, `user`, `access`,
  `system`, `admin`, matched case-insensitively) is present and its suffix is not valid v2 grammar
  (`isV2Suffix`). A token with any other prefix (`openid`, `profile`) is kept. Returns the joined
  string.
- In `processUserInfo`, right after `context.userType` is set to the delegated user type and before
  the Consent lookup (so a refused token costs nothing): when the flag is on and the actor is a
  RelatedPerson (`context.actor.isOrganizationActor` is false; RelatedPerson and Organization are the
  only allowed actor types), replace `scope` with the filtered string.
- If the filtered string has no `patient/` token left, refuse with `done(null, false, { reason:
  'delegated_actor_no_v2_scope' })`, logged with `logWarn('Auth rejected', ...)` like the existing
  rejections. This is a 401 at login, matching `no_scope`.
- `isUser` was derived from the raw scope, so a v1-only delegate has `isUser` true. The explicit
  refusal above is what keeps `isUser` and `hasPatientScope` in agreement: the filtered string is
  never allowed to reach the request path without a `patient/` token, which would otherwise make
  `hasPatientScope` throw on an empty scope and skip the self-only restriction in
  `personToPatientIdsExpander`.

## Decisions (my calls, correct me)

- **Refusal is 401 at login.** Chosen by the owner.
- **Only RelatedPerson delegated tokens are affected (confirmed by the owner).** Organization actors
  are exempt. They only read, and the ticket lists their treatment as still
  to confirm, so they keep v1 scopes for now. Moving them is a one-line follow-up (drop the
  `isOrganizationActor` check).
- **All five prefixes are filtered**, because the always-on `access/*` and `user/*` scopes are to be
  minted as letters too, and a surviving `admin/*.write` would still gate the admin delete routes.
- **The flag stands alone and fails closed.** If it is on while `ENABLE_SMART_V2_CRUDS_SCOPES` is off,
  the letters do not parse downstream, so a delegate gets 403s instead of silently keeping v1. The
  readme says to turn the two on together.

## Tests

- Unit, `smartScopeParser`: parameterized cases for v1 dropped, v2 kept, both on one token string,
  non-resource scopes kept, wrong-case prefix, bare `read`/`write`/`*`, letters out of order, empty
  string.
- Unit, `AuthService.processUserInfo`: flag off leaves the scope unchanged; flag on filters; v1-only
  delegate refused with the new reason; letters-only delegate passes; Organization actor unchanged;
  non-delegated token with v1 scopes unchanged.
- Integration: a delegated token with v1 scopes gets 401; one with letters reads and is limited to
  those letters (a write without `c`/`u` gets 403).
- Integration, existing reads with the flag on (`delegatedV2ScopesOnlyRead.test.js`): a delegate with
  letter scopes keeps search in every response mode, read by id, Patient `$everything` and the
  Consent's sensitivity filtering; the read-only operation gate still refuses create and history; a
  v1 scope next to letters is not honored; a delegate with the flag off and a user token without an
  `act` claim still read with v1 scopes.
- Config: the flag is in the env-matrix test.

## Docs

A short section in `readme/delegatedActorAccess.md`: the flag, that it needs the v2 flag, and what a
delegate can no longer present.
