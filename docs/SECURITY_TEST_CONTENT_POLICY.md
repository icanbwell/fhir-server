# What may and may not appear in security test files

`icanbwell/fhir-server` is a public MIT-licensed repository. Security test files are
read by anyone, indexed by GitHub code search, and copied into every fork. This policy
applies to every file under `src/tests/security/**` and to any test whose subject is
access control.

It is enforced by `scripts/security/check_test_language.js`, which runs in the lint job
on every pull request. See [Enforcement](#enforcement).

## Scope: the path counts too

Three surfaces carry this content, in increasing order of durability:

| Surface | Who sees it |
|---|---|
| Comments and docblocks | anyone who opens the file |
| `describe` and `test` names | anyone reading a CI log, plus anyone who opens the file |
| **File and directory names** | **anyone looking at the file tree, every CI log line that names the file, GitHub code search, every fork, and git history after a rename** |

A file name is the hardest to walk back. Name a directory for the property under test
(`..._isolation`, `..._scoping`, `..._authorization`), never for what could go wrong.

## Do not include

**Incident identifiers, or anything that maps a ticket to a mechanism.**
Not `INC-331`, not `SEC-1580`, not "the X incident", not "the fix for Y". A bare ticket
number next to a test that demonstrates a mechanism is an attribution: it tells a reader
which code path a given ticket concerned, and a set of them tells a reader the shape of
the ticket space. Reference the specification rule identifier instead (`IDG-5`, `SAE-2`,
`CL-1`, `AUTH-1`), which describes a rule rather than an event. Feature tickets
(`DCON-…`, `QUAL-…`) are fine; they describe work, not an event.

**Statements about what was observed in a deployed environment.**
No "on staging, records were found reachable", no "this returned data in dev", no counts
of affected records, no environment names paired with behavior. Describe the shape under
test using the synthetic fixtures the test creates.

**Characterizations of the code as having lost data or as attackable.**
Not leakage, leaked, breach, exfiltration, vulnerability, vulnerable, attack surface,
exploit; not in comments, test names, describe blocks, fixture ids, helper names or
paths. Helper and variable names surface in CI output. Use precise technical language:
a record is *returned* or *withheld*; a caller *is* or *is not* authorized; a control is
*applied* or *not applied*.

`PHI` on its own is fine and is the correct clinical term. `PHI` next to a loss verb is
not.

**Deployed infrastructure detail.** Non-public hostnames, identity-pool identifiers, real
tenant or client slugs, bucket names, real record identifiers, credential values.
Synthetic tenants only (`tenanta`, `tenantb`, `proasrc`). `fhir.icanbwell.com` and
`fhir.dev.icanbwell.com` are the repo's existing public test constants and are not in
scope.

**Severity ratings on unfixed behavior.** "Critical", "High" and similar next to a
described gap turn a test file into a prioritized target list.

**Working reproductions of an unfixed issue.** See below.

## Say instead

| Not this | This |
|---|---|
| the INC-331 cause | tracked under CACHE-2 |
| this is the leak from the incident | reachability must follow a link, not a shared identifier |
| tenant A can steal tenant B's PHI | tenant A must not receive tenant B's records |
| SEVERITY: CRITICAL, systematic leak window | the target state is that a revoked consent stops unlocking |
| we found this in staging | the shape under test is |
| `nested_resource_tag_leak/` | `nested_resource_tag_isolation/` |
| Vulnerabilities tested: 1. … (Critical) | Rules asserted: IDG-5, SAE-2 |

## Unfixed issues

A test that demonstrates a currently-unfixed access-control gap is a working
reproduction. Publishing it before the fix lands hands a reader both the technique and
confirmation that it works.

Those tests belong in a private repository until the corresponding fix merges, and are
then ported here as a regression test that passes. A test that asserts the correct
behavior and passes is not a reproduction and is safe to publish.

The same applies to the quarantine list in `jest.config.js`. An entry there is a public
statement that a named file's assertions do not hold. Keep entries to a bare path and
keep the surrounding comment about mechanics, not about what any individual entry means.

## Enforcement

```bash
yarn run check:security_language              # changed files vs the base ref, plus src/tests/security
node scripts/security/check_test_language.js --all    # whole test tree, audit mode
```

The default scope is deliberately narrow: files this branch changed, plus everything
under `src/tests/security` whether it changed or not. The rest of the tree predates this
policy, and remediating it is tracked separately, so scanning it by default would make
the check fail on every branch and get it switched off. `--all` is the audit mode for
that remediation work.

When a match is unavoidable and benign, append or precede the line with
`// security-language-ok: <reason>`. Use it sparingly and always with a reason; a bare
suppression is indistinguishable from a mistake.

## When in doubt

Ask whether a reader with no context could use the file to (a) identify a real
environment, (b) conclude that a specific ticket concerned a specific data path, or
(c) reproduce an access-control gap that is still open. If any of the three, it does not
go in this repository as written.
