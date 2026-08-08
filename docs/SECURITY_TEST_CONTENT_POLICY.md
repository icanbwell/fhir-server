# What may and may not appear in security test files

`icanbwell/fhir-server` is a public repository. Security test files are read by
anyone. This policy applies to every file under `src/tests/security/**` and to
any test whose subject is access control.

## Do not include

**Incident identifiers, or anything that maps a ticket to a mechanism.**
Not `INC-331`, not "the X incident", not "the fix for Y". A bare ticket number
next to a test that demonstrates a mechanism is an attribution: it tells a
reader which code path a given ticket concerned. Reference the security
specification rule identifier instead (`IDG-5`, `SAE-2`, `CL-1`), which
describes a rule rather than an event.

**Statements about what was observed in a deployed environment.**
No "on staging, records were found reachable", no "this returned data in dev",
no counts of affected records, no environment names paired with behavior.
Describe the shape under test using the synthetic fixtures the test creates.

**The words leak, breach, exposure, exposed, vulnerability, or PHI**, in
comments, test names, describe blocks, fixture ids, or helper names. Helper and
variable names surface in CI output. Use precise technical language: a record is
*returned* or *withheld*; a caller *is* or *is not* authorized; a control is
*missing* or *not applied*.

**Deployed infrastructure detail.** Hostnames, identity-pool identifiers, real
tenant or client slugs, bucket names, real record identifiers, credential
variable values. Synthetic tenants only (`tenanta`, `tenantb`, `proasrc`).

**Working reproductions of an unfixed issue.** See below.

## Say instead

| Not this | This |
|---|---|
| the INC-331 cause | tracked under CACHE-2 |
| this is the leak from the incident | reachability must follow a link, not a shared identifier |
| tenant A can steal tenant B's PHI | tenant A must not receive tenant B's records |
| SEVERITY: CRITICAL, systematic leak window | the target state is that a revoked consent stops unlocking |
| we found this in staging | the shape under test is |

## Unfixed issues

A test that demonstrates a currently-unfixed access-control gap is a working
reproduction. Publishing it before the fix lands hands a reader both the
technique and confirmation that it works.

Those tests belong in a private repository until the corresponding fix merges,
and are then ported here as a regression test that passes. A test that asserts
the correct behavior and passes is not a reproduction and is safe to publish.

## When in doubt

Ask whether a reader with no context could use the file to (a) identify a real
environment, (b) conclude that a specific ticket concerned a specific data path,
or (c) reproduce an access-control gap that is still open. If any of the three,
it does not go in this repository as written.
