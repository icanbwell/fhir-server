# Standalone resources from summary Compositions: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read operation that loads a person's summary Compositions and returns the resources
rebuilt from them in one Bundle.

**Architecture:** A pure mapper (`CompositionResourceMapper`) turns one Composition into resources
using a per-domain table of row title to setter. An operation class searches Compositions through
the normal search path, runs the mapper, filters by `_type` and returns a `collection` Bundle. No
new datastore, no writes, no call to another service.

**Tech stack:** Node, CommonJS, Jest (`jest.unit.config.js` for unit, the default config for
integration), the existing IoC container and `searchBundleOperation`.

**Spec:** `docs/specs/composition-resources-on-read.md`

## Global constraints

- The operation reads Compositions only, and only through `searchBundleOperation.searchBundleAsync`.
  No direct database access.
- The delegated-user section filter runs before the mapper. A denied section yields no resource.
- Off by default: `ENABLE_COMPOSITION_RESOURCES_OPERATION`.
- The mapper invents no value. A required field the Composition lacks is reported, not defaulted.
- Logs, metrics and the mapping report carry row titles and type names, never row values.
- Fixtures are synthetic. The golden files are copies of the composition service's test outputs.
- New files are camelCase and sit in the folder for their role. eslint is the gate (no trailing
  commas).
- Does not merge before the Tech Design Review and the FDR named in the spec.

## Review focus

Inputs the spec implies that are most likely to bite, each pinned by a test in the task that owns
the code:

1. A delegated user denied a sensitivity category: the section's resource must be absent (Task 3).
2. A Composition from another tenant or outside the token's patient scope: not returned (Task 3).
3. A row title the tables do not know: counted and logged by title, resource still returned
   (Task 4).
4. A lab Composition with thousands of sections: bounded time and a hard cap (Task 2).
5. A person with no summary Compositions, and `_type` naming a type with no resources: empty Bundle,
   200 (Task 2).

---

### Task 1: Pure mapper (done)

**Files:**

- `src/utils/compositionResourceMapper/compositionResourceMapper.js`
- `src/utils/compositionResourceMapper/domainMappings.js`
- `src/utils/compositionResourceMapper/fieldSetters.js`
- `src/utils/compositionResourceMapper/rowValues.js`
- Test: `src/tests/unit/utils/compositionResourceMapper/compositionResourceMapper.test.js`
- Fixtures: `src/tests/unit/utils/compositionResourceMapper/fixtures/{rich,duplicates}/*.json`

**Interfaces produced:**

- `new CompositionResourceMapper({ domainMappings? })`
- `mapComposition(composition) -> { resources: Object[], report: MappingReport }`
- `mapToBundle(compositions) -> { bundle: Bundle, report: MappingReport }`
- `MappingReport = { skippedCompositionTypes: string[], unmappedResourceTypes: string[],
unknownRows: {resourceType, title}[], unparsedRows: {resourceType, title}[],
missingRequired: {resourceType, field}[] }`
- `SOURCE_RESOURCE_EXTENSION_URL`

- [x] Tests written first and seen failing (module missing)
- [x] Mapper for all eleven Composition type codes
- [x] Contract test: every golden Composition maps with no unknown rows, unparsed values or
      unmapped types
- [x] eslint clean; unit suite green

Run: `NODE_ENV=test node ./node_modules/.bin/jest --config jest.unit.config.js --no-watchman --forceExit src/tests/unit/utils/compositionResourceMapper`

### Task 2: Operation class

**Files:**

- Create: `src/operations/compositionResources/compositionResources.js`
- Modify: `src/utils/configManager.js` (flag and cap)
- Test: `src/tests/unit/operations/compositionResources/compositionResources.test.js`

**Interfaces:**

- Consumes: `CompositionResourceMapper.mapToBundle`, `searchBundleOperation.searchBundleAsync`,
  `r4ArgsParser.parseArgs` (same call shape as `src/operations/summary/summary.js`, the
  `includeSummaryCompositionOnly` branch).
- Produces: `class CompositionResourcesOperation` with
  `compositionResourcesAsync({ requestInfo, res, parsedArgs, resourceType }) -> Promise<Bundle>`;
  `configManager.enableCompositionResourcesOperation` (env
  `ENABLE_COMPOSITION_RESOURCES_OPERATION`, default false);
  `configManager.compositionResourcesMaxSections` (env `COMPOSITION_RESOURCES_MAX_SECTIONS`,
  default 20000).

- [ ] **Step 1: failing tests** with a stubbed `searchBundleOperation`:
    - searches `Composition` with `patient=<proxy patient id>` and the identifier
      `https://fhir.icanbwell.com/4_0_0/CodeSystem/composition/bwell|bwell_composition_for_health_data_summary`
    - `_type=Condition,Procedure` returns only those types; no `_type` returns all
    - no Compositions returns `{ resourceType: 'Bundle', type: 'collection', entry: [] }`
    - a Composition whose section count exceeds the cap throws a `BadRequestError` naming the cap
    - flag off throws `NotFoundError`
- [ ] **Step 2:** run and confirm they fail because the class does not exist
- [ ] **Step 3:** implement. Count sections with one recursive walk before mapping.
- [ ] **Step 4:** run and confirm green
- [ ] **Step 5:** commit

### Task 3: Wire the route and prove access control

**Files:**

- Modify: `src/profiles.js` (add `{ name: 'compositionResources', route:
'/:id/$composition-resources', method: 'GET' }` to Patient and Person, next to `summary`)
- Modify: `src/operations/fhirOperationsManager.js` (method `compositionResources`, modelled on
  `summary`: `verifyAccess` with `operation: 'compositionResources'`, Person mapped to the proxy
  patient, `getParsedArgsAsync` with `operation: READ`)
- Modify: `src/createContainer.js` (register `compositionResourcesOperation`, inject into
  `fhirOperationsManager`)
- Modify: `src/middleware/fhir/4_0_0/controllers/operations.controller.js` only if
  `readCustomOperation` does not already write a Bundle correctly
- Test: `src/tests/integration/compositionResources/compositionResources.test.js` with synthetic
  fixtures under `fixtures/`

**Interfaces:**

- Consumes: `CompositionResourcesOperation.compositionResourcesAsync` from Task 2.
- Produces: `GET /4_0_0/Patient/:id/$composition-resources`, `GET /4_0_0/Person/:id/$composition-resources`.

- [ ] **Step 1: failing integration tests** (`test.each` where inputs vary):
    - happy path: merge a golden conditions Composition, call the operation, get the Conditions
    - delegated user denied a sensitivity category: the resource built from that section is absent
    - a token whose access tags do not cover the Composition gets an empty Bundle
    - a patient-scoped token for another patient gets 403 or an empty Bundle, matching `$summary`
    - Person route returns the same Bundle as the proxy-patient route
- [ ] **Step 2:** run and confirm they fail with 404 on the route
- [ ] **Step 3:** wire the route, manager method and container registration
- [ ] **Step 4:** run and confirm green. If the delegated-user test fails because the enrichment
      does not run on an internal search, call `filterCompositionSensitiveSections` in the operation
      before mapping and keep the test.
- [ ] **Step 5:** read `review.md` and check the diff against it; note the result in the PR
- [ ] **Step 6:** commit

### Task 4: Observability

**Files:**

- Modify: `src/utils/metrics.js` (`recordCompositionResources({ resourceType, returned, report,
durationMs })`)
- Modify: `src/operations/compositionResources/compositionResources.js`
- Test: `src/tests/unit/operations/compositionResources/compositionResources.test.js`

- [ ] **Step 1: failing tests:** an unknown row increments the unknown-rows counter tagged with the
      resource type; the log line for it contains the title and not the value; duration is recorded
- [ ] **Step 2:** run and confirm they fail
- [ ] **Step 3:** implement counters for returned, unknown rows, unparsed rows, missing required and
      skipped Composition types, plus a duration histogram; one `logWarn` per call when the report is
      not empty
- [ ] **Step 4:** run and confirm green
- [ ] **Step 5:** commit

### Task 5: Keep the fixtures in step

**Files:**

- Create: `src/admin/scripts/syncCompositionGoldenFixtures.js` (copies
  `tests/domain/golden/expected/{rich,duplicates}/*.json` from a composition-service checkout path
  given as an argument)
- Modify: `readme/` entry for the operation, including how to refresh fixtures

- [ ] **Step 1:** script with a unit test over a temp directory: copies only the two cases, fails
      with a clear message when the source path is missing
- [ ] **Step 2:** run the script against a current composition-service checkout, then the contract
      test; fix any table the new fixtures expose
- [ ] **Step 3:** commit

### Task 6: Verify and roll out

- [ ] Unit suite: `NODE_ENV=test node ./node_modules/.bin/jest --config jest.unit.config.js --no-watchman --forceExit`
- [ ] Integration suites for `compositionResources`, `summary` and `enrich`
- [ ] `make lint`
- [ ] Dev, flag on: call the operation for a synthetic person, compare resource counts per type with
      the section counts in that person's Compositions, and check the counters
- [ ] Widen only after the Tech Design Review and FDR are approved
