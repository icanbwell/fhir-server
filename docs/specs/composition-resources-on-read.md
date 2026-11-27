# Standalone resources from summary Compositions, on read

## Goal

Give a caller the cleaned, deduplicated view of a person's record as ordinary FHIR resources
(Condition, Procedure, AllergyIntolerance and so on) without making them parse a Composition.

The composition service already does the hard work: it filters, deduplicates and groups a person's
resources and writes one summary Composition per domain. Today a caller who wants that cleaned view
has to walk nested sections and read label/value rows. This change adds a read operation that loads
those Compositions and returns the resources rebuilt from them, in one Bundle.

Out of scope: writing anything back, changing what the composition service produces, and changing
`$summary`.

## What a summary Composition holds

Checked against the composition service's golden outputs (copied to
`src/tests/unit/utils/compositionResourceMapper/fixtures`).

- `Composition.type.coding` names the domain. Eleven codes are in use:
  `allergyintolerance_`, `careplan_`, `condition_`, `document_`, `encounter_`, `immunization_`,
  `medication_`, `lab_`, `vital_` and `procedure_summary_document`, plus `pregnancy_episode_document`.
- A group section carries a `code` (the cleaned coding), `entry` references to the source resources
  in the group, and sometimes extensions.
- Its leaf sections are rows: a `title` (the label) and `text.div` (the display value).
- Labs nest up to seven levels, and the same source can appear in more than one section (the result
  itself, then again under "Out of Range Details").
- Medication sections reference a derived `MedicationStatement` the composition service already
  persists, not the source request or dispense.

Two things follow. The cleaned code and the grouping are structured, so they carry over exactly. The
other values are display strings, so each one is parsed, and a value that does not parse is left out.

## Behaviour

`GET /4_0_0/Patient/{id}/$composition-resources` (and the `Person/{id}` form, mapped to the proxy
patient the way `$summary` does it).

- `_type` (optional, comma-separated resource types) limits the Bundle to those types.
- The response is a `collection` Bundle, one entry per rebuilt resource, `fullUrl` `urn:uuid:<id>`.
- A person with no summary Compositions gets an empty Bundle and 200.
- The operation is off unless `ENABLE_COMPOSITION_RESOURCES_OPERATION` is set.

The operation name is a proposal. It is settled in the Tech Design Review.

## Mapping rules

Implemented in `src/utils/compositionResourceMapper/`. The mapper is a pure function of the
Composition: it reads nothing else.

- **One resource per group of sources.** Sections whose `entry` references are the same build one
  resource, so a lab's interpretation from "Out of Range Details" lands on the same Observation.
- **Resource type** comes from the section's `entry[].type`, not from the Composition. Labs return
  Observation and DiagnosticReport; the pregnancy Composition returns a Condition.
- **Code.** The section `code` goes to the resource's code field (`code`, `vaccineCode`,
  `medicationCodeableConcept`, `type`; for Encounter the v3 ActCode coding becomes `class` and the
  rest `type`). Codings with no code, or the literal string `null`, are dropped. The pregnancy
  section code is a b.well section type, so it is not carried.
- **Sensitivity.** Sensitivity-category codings the composition service appends to the section code
  move to `meta.security` on the rebuilt resource, which is where source resources carry them.
- **Rows.** Each domain has a table of row title to setter (`domainMappings.js`). A row with no
  FHIR field on that resource is declared narrative-only. A title that is in no table is reported.
- **Placeholders.** `Unknown`, `Not specified`, `Not provided by source` and their variants mean the
  source had nothing; no typed field is written.
- **Dates.** A dateTime with a time but no timezone is not valid FHIR, so it is cut back to its
  date. An instant needs the timezone and is left out without one.
- **Coded values.** A required-binding code is written only when the value is in the value set. A
  CodeableConcept always gets the display as `text` and gets a coding when the display is one the
  code system defines.
- **Narrative.** Every row, mapped or not, is written to `text.div`, re-escaped. Nothing the
  Composition says is dropped.
- **Subject, meta.** `Composition.subject` becomes `subject` or `patient`. `meta.security` and
  `meta.source` are copied from the Composition.
- **Id.** A UUIDv5 of the Composition id, the resource type and the source references: stable across
  calls, but not an id a caller can `GET`. A medication reuses the id of the persisted
  MedicationStatement its section references.
- **Source links.** Observation uses its native `derivedFrom`. MedicationStatement gets
  `derivedFrom` from the "MedicationRequest ID" row. Every other type gets one
  `composition-source-resource` extension per source reference.

## What does not carry over

- **Required fields the Composition does not hold.** `CarePlan.intent`,
  `DocumentReference.content` and a vitals `Observation.status` are absent. The mapper reports them
  and does not invent a value, so those three types are not valid R4 until the composition service
  carries the field or we agree a default.
- **References.** Performer, location, recorder and prescriber come back as `display` text. The
  Composition holds names, not references.
- **Row titles not in the fixtures.** The tables cover the titles the golden cases exercise. A new
  or renamed title shows up as an unknown row, still present in the narrative.
- **Appointment.** Encounter sections that reference an Appointment are reported as unmapped.

## Access control

The operation reads Compositions and nothing else, and it reads them through the normal search path
(`searchBundleOperation`), never the database directly. That gives it, unchanged:

- scope and access-tag filtering on the Composition search;
- patient scoping for patient-scoped tokens;
- the delegated-user section filter (`CompositionSectionFilterEnrichmentProvider`), which must run
  before the mapper sees a section. A denied section must produce no resource. This is a test, not
  an assumption: whether the enrichment runs on an internal `searchBundleAsync` call is not yet
  confirmed.

Rebuilt resources carry the Composition's security tags plus any sensitivity codings from their
section, so anything downstream that filters on `meta.security` still works.

## Report and observability

The mapper returns a report next to the resources. It holds titles and type names only, never a row
value, so it is safe to log.

| Field                     | Meaning                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `skippedCompositionTypes` | A Composition whose type code has no table                                        |
| `unmappedResourceTypes`   | A section references a type its domain has no spec for                            |
| `unknownRows`             | A row title that is in no table: the composition service added or renamed a label |
| `unparsedRows`            | A value that could not be turned into its field                                   |
| `missingRequired`         | An R4 required field the Composition did not supply                               |

The operation emits a counter for each, tagged with resource type, plus resources returned and
duration. `unknownRows` is the one to alert on: it means the two services have drifted.

## Reviews this needs before it merges

- **Tech Design Review.** A new public operation on the FHIR API.
- **FDR.** The `composition-source-resource` extension, the section extensions copied onto
  Observation, and the shape of resources built without their required fields.
- **Composition service owners.** The row titles become a contract. Agree how the golden fixtures
  stay in step: today they are a copy.

## Alternatives considered

- **Return the group's winner source resource, with the section code overlaid.** Typed, complete,
  and a real id the caller can fetch, with no label parsing. Not chosen because the cleaned values
  (merged sources, derived status, friendly names, date fallbacks) live in the rows and would be
  lost. Worth revisiting if the missing required fields turn out to block callers.
- **Composition service persists derived resources** (what it does for MedicationStatement). Typed
  at the source, no parsing. Costs a `$merge` write per group per regeneration, needs a retraction
  path for groups that disappear, and feeds derived resources back into `$everything`.
- **Load conversion scripts into the server at runtime.** Rejected: unreviewed code running next to
  PHI and the tenant filters.
- **`$graph` over `section.entry`.** Returns the raw source resources, duplicates included. Useful,
  but it is not the cleaned view.

## Risks

- **Label coupling.** A renamed label silently stops populating a field. Mitigated by the contract
  test over the golden fixtures and the `unknownRows` counter, and only as good as the fixture sync.
- **Large Compositions.** A lab Composition can hold thousands of sections. The mapper is linear in
  sections and allocates one resource per group; the operation needs a size cap and a duration
  metric before it is switched on for real traffic.
- **Unfetchable ids.** A caller who stores a rebuilt id cannot read it back. The source links are
  the way to the real resources.
- **Upstream data quality.** A fixture section carries the literal string `null` as its SNOMED
  code. The mapper drops it; the composition service should stop writing it.
