# Composite FHIR Search Parameter Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `type: 'composite'` FHIR search parameters (e.g. `Observation`'s `code-value-quantity`, `component-code-value-quantity`, `combo-code-value-quantity`; `DocumentReference`'s `relationship`; the 4 genomics 3-component composites) actually filter, instead of being silently accepted and ignored, across REST, GraphQL, and MCP.

**Architecture:** Extend the code generator to resolve each composite's `component[]` definitions into per-scope field metadata (`SearchParameterDefinition{ type: 'composite', scopes: [{ components: [...] }] }`), reusing the existing per-resource field table pass 1 already builds. At request time, `R4ArgsParser` finds this definition like any other; a new `FilterByComposite` reuses the existing per-type filter classes' own `.filter()` method per component, wraps array-scoped components in `$elemMatch`, ANDs components within a scope, and ORs scopes together.

**Tech Stack:** Python 3 (generator, pytest), Node.js/CommonJS (server, Jest), MongoDB query DSL.

**Spec:** `docs/superpowers/specs/2026-08-09-composite-search-params-design.md`

## Global Constraints

- **This branch (`composite-search-params`) is ~109 commits behind `origin/main` and stale for this feature.** All file/line references, class shapes, and file paths below were verified against `origin/main` (commit `191167175`), not this branch's current tree — several relevant files have moved or changed since this branch was cut (e.g. `src/tests/searchParameters/search_by_token/` is now `src/tests/integration/searchParameters/search_by_token/`; `generatorScripts/mcp/generate_mcp_tools.py` and `TYPE_VALUE_SYNTAX_HINTS` did not exist on this branch at all — they landed on `main` afterward). **Before starting Task 1, rebase this branch onto `origin/main`** (or cut a fresh branch from `origin/main` and re-apply just the design doc). Do not attempt to implement against this branch's current tree.
- Prettier: 100 char width, semicolons, single quotes, 4-space indent, ES5 trailing commas (JS files).
- CommonJS modules (`require`/`module.exports`) — no ESM.
- Python generator code: match the existing style in `generatorScripts/searchParameters/generate_search_parameters.py` (dataclasses, type hints, no external deps beyond what's already imported).
- Run `make lint` before each commit; the pre-commit hook runs it too.
- This plan targets `origin/main` at commit `191167175` (DCON-5398, 2026-09-04). If more commits land on `main` before implementation starts, re-verify line numbers/signatures cited below — they may have shifted.

---

## Design Refinements Found While Planning

The spec (`docs/superpowers/specs/2026-08-09-composite-search-params-design.md`) is directionally correct but glosses over four mechanics that only became visible from reading the actual code and the raw `search-parameters.json` entries. This section documents them so Tasks 1–5 aren't marching to a description that doesn't survive contact with the real data:

1. **A referenced component code can itself be multi-field, and the right field must be picked per scope, not reused wholesale.** E.g. `combo-code-value-quantity`'s component `code` resolves (via its `definition` URL) to `Observation-combo-code`, whose own `expression` is `Observation.code | Observation.component.code` — i.e. it already has _two_ fields, one root (`code`) and one array (`component.code`). The composite's root scope must pick the root field; its array scope must pick the array field. Simply "looking up the code in the pass-1 table" (as the spec's Architecture section puts it) is necessary but not sufficient — you get a list of candidate fields per code and must filter by scope.
2. **Polymorphic `value[x]` components need `.as(Type)`-cast narrowing on top of scope filtering.** `Observation-value-quantity` (referenced by `code-value-quantity`'s second component) has _eleven_ xpath variants (`valueQuantity`, `valueCodeableConcept`, `valueString`, … `valuePeriod`) because FHIR's `value[x]` is polymorphic — all under the root scope, so scope-filtering alone doesn't narrow to one. The composite component's own `expression` is `value.as(Quantity)`; matching FHIR's universal `value` + `TypeName` naming convention against the candidate fields' leaf segment (expected `valueQuantity`) is what picks the one real field. This affects every composite whose component references a `*value-quantity` search parameter (`code-value-quantity`, `component-code-value-quantity`, `combo-code-value-quantity` — i.e. most of the Observation composites), not just the "combo" ones.
3. **`:missing`, not just `:contains`/`:above`/`:below`/`:text`/`:of-type`, needs an explicit composite guard.** `R4SearchQueryCreator.buildR4SearchQuery` (`src/operations/query/r4.js`) dispatches on modifier _before_ the type switch:
    ```js
    if (parsedArg.modifiers.includes('missing')) {
        andSegments = new FilterByMissing(filterParameters).filter();
    } else if (parsedArg.modifiers.includes('contains')) { ... }
    ```
    `FilterByMissing`/`FilterByContains`/`FilterByAbove`/`FilterByBelow`/`FilterByOfType` all inherit `BaseFilter.filter()`'s default body, which does `this.propertyObj.fields.flatMap(...)`. `SearchParameterDefinition.fields` is a getter that returns `[]` when neither `field` nor `fields` was passed to the constructor — which is exactly the composite's own top-level definition (it only gets `scopes`). `[].flatMap(...)` doesn't throw; it silently produces `{$or: []}`, an always-false Mongo condition. So today's spec claim that `:missing` "needs no special handling" is wrong: on a composite param it would silently return zero rows, not the 400 the spec implies "no special handling" gets you elsewhere, and not a real not-missing check either — composite params have several underlying paths, and no defined semantics for what "missing" means across all of them. **Decision: reject `:missing` for composite params with the same `BadRequestError` as the other five modifiers**, rather than ship silently-wrong (empty-result) behavior or invent undocumented multi-field-missing semantics. `FilterByText` has the same `this.propertyObj.fields.flatMap(...)` shape in its own `filterText()`, confirming this is a general BaseFilter-family issue, not specific to one class.
4. **`useHistoryTable` must not double-prefix fields nested inside `$elemMatch`.** `FieldMapper.getFieldName(field)` prepends `resource.` when searching the history collection. That prefix must apply exactly once, to the array field itself (e.g. `resource.component`), not to each field _inside_ the `$elemMatch` (which are already relative to the matched array element, e.g. `code`, not `resource.code`). `FilterByComposite` must build each array-scoped component's sub-filter with a `FieldMapper` constructed as `{ useHistoryTable: false }`, regardless of the outer request's real `useHistoryTable` value, and apply the real `FieldMapper` only once, to the array field name in the wrapping `{ [arrayField]: { $elemMatch: ... } }`.

---

## File Structure

| File                                                                                                      | Responsibility                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/searchParameters/searchParameterTypes.js` (modified)                                                 | `SearchParameterDefinition` gains `scopes` (composite scope/component metadata) and `arrayField` (component-only: the array this component's field lives under, or `null`). |
| `generatorScripts/searchParameters/generate_search_parameters.py` (modified)                              | Pass 2: resolve every `type: 'composite'` entry's `component[]` into `scopes[].components[]`, per the algorithm in Task 2.                                                  |
| `generatorScripts/searchParameters/test_generate_search_parameters.py` (new)                              | Targeted + exhaustive tests for pass 2.                                                                                                                                     |
| `src/operations/query/customQueries.js` (modified)                                                        | Add `composite: 'composite'` to `fhirFilterTypes`.                                                                                                                          |
| `src/operations/query/r4ArgsParser.js` (modified)                                                         | Resolve `fieldType` per composite component (mirrors the existing top-level `fieldType` resolution).                                                                        |
| `src/operations/query/r4.js` (modified)                                                                   | Reject 5 rejected modifiers for composite params before the modifier-dispatch chain reaches classes that would silently misbehave; add `case fhirFilterTypes.composite`.    |
| `src/operations/query/filters/composite.js` (new)                                                         | `FilterByComposite extends BaseFilter` — the actual composite filter-building logic.                                                                                        |
| `src/tests/unit/operations/query/filters/composite.test.js` (new)                                         | Unit tests for `FilterByComposite`.                                                                                                                                         |
| `src/tests/integration/searchParameters/search_by_composite/` (new)                                       | REST + MCP end-to-end tests.                                                                                                                                                |
| `src/mcp/typeValueSyntaxHints.js` (regenerated) / `generatorScripts/mcp/generate_mcp_tools.py` (modified) | Add a real `'composite'` entry to `TYPE_VALUE_SYNTAX_HINTS`.                                                                                                                |

---

### Task 1: `SearchParameterDefinition` gains `scopes`/`arrayField`

**Files:**

- Modify: `src/searchParameters/searchParameterTypes.js`
- Test: `src/tests/unit/searchParameters/searchParameterTypes.test.js` (new)

**Interfaces:**

- Produces: `new SearchParameterDefinition({ type: 'composite', scopes: [{ components: [SearchParameterDefinition, ...] }, ...], description })` for a composite entry. Each component is itself a `SearchParameterDefinition` (so it already has `.type`, `.field`/`.fields`/`.firstField`, `.fieldFilter`, `.fieldType`, `.fieldTypesObj`) plus a new `.arrayField` (`string|null`) set only on components.
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Write the failing test**

```js
// src/tests/unit/searchParameters/searchParameterTypes.test.js
const { describe, test, expect } = require('@jest/globals');
const { SearchParameterDefinition } = require('../../../searchParameters/searchParameterTypes');

describe('SearchParameterDefinition composite support', () => {
    test('stores scopes and exposes them unchanged', () => {
        const component = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: null,
        });
        const def = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [component] }],
        });
        expect(def.type).toBe('composite');
        expect(def.scopes).toHaveLength(1);
        expect(def.scopes[0].components[0]).toBe(component);
        expect(def.scopes[0].components[0].arrayField).toBeNull();
    });

    test('arrayField defaults to null when not passed', () => {
        const component = new SearchParameterDefinition({ type: 'token', field: 'code' });
        expect(component.arrayField).toBeNull();
    });

    test('clone() deep-copies scopes and each component (including arrayField)', () => {
        const component = new SearchParameterDefinition({
            type: 'token',
            field: 'component.code',
            arrayField: 'component',
        });
        const def = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [component] }],
        });
        const cloned = def.clone();
        expect(cloned).not.toBe(def);
        expect(cloned.scopes[0].components[0]).not.toBe(component);
        expect(cloned.scopes[0].components[0].field).toBe('component.code');
        expect(cloned.scopes[0].components[0].arrayField).toBe('component');
    });

    test('toJSON() includes scopes', () => {
        const component = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const def = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [component] }],
        });
        const json = def.toJSON();
        expect(json.scopes[0].components[0].field).toBe('valueQuantity');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/searchParameters/searchParameterTypes.test.js`
Expected: FAIL — `def.scopes` is `undefined`, `component.arrayField` is `undefined` (not `null`), `clone()`/`toJSON()` don't carry `scopes`.

- [ ] **Step 3: Implement**

In `src/searchParameters/searchParameterTypes.js`, update the typedef comment, constructor, `clone()`, and `toJSON()`:

```js
/**
 * @typedef {('token'|'string'|'reference'|'date'|'quantity'|'uri'|'datetime'|'instant'|'period'|'email'|'phone'|'canonical'|'number'|'special'|'composite')} SearchParameterDefinitionType
 **/

class SearchParameterDefinition {
    /**
     * constructor
     * @param {string|undefined} [description]
     * @param {SearchParameterDefinitionType} type
     * @param {string|undefined} [field]
     * @param {string[]|undefined} [fields]
     * @param {string|undefined} [fieldFilter]
     * @param {string[]|undefined} [target]
     * @param {string|undefined} [fieldType]
     * @param {Object|undefined} [fieldTypesObj]
     * @param {{components: SearchParameterDefinition[]}[]|undefined} [scopes] composite params only
     * @param {string|null|undefined} [arrayField] composite components only: the array field
     *   this component's `field` lives under (e.g. 'component'), or null for a root-scoped
     *   component
     */
    constructor({
        description,
        type,
        field,
        fields,
        fieldFilter,
        target,
        fieldType,
        fieldTypesObj,
        scopes,
        arrayField,
    }) {
        // ...existing assignments unchanged...
        /**
         * @type {{components: SearchParameterDefinition[]}[]|undefined}
         */
        this.scopes = scopes;
        /**
         * @type {string|null}
         */
        this.arrayField = arrayField || null;
    }

    // ...existing getters unchanged...

    clone() {
        return new SearchParameterDefinition({
            description: this.description,
            type: this.type,
            field: this._field,
            fields: this._fields,
            fieldFilter: this.fieldFilter,
            target: this.target,
            fieldType: this.fieldType,
            fieldTypesObj: this.fieldTypesObj,
            scopes: this.scopes
                ? this.scopes.map((scope) => ({
                      components: scope.components.map((c) => c.clone()),
                  }))
                : undefined,
            arrayField: this.arrayField,
        });
    }

    toJSON() {
        return {
            description: this.description,
            type: this.type,
            field: this._field,
            fields: this._fields,
            fieldFilter: this.fieldFilter,
            target: this.target,
            fieldType: this.fieldType,
            fieldTypesObj: this.fieldTypesObj,
            scopes: this.scopes
                ? this.scopes.map((scope) => ({
                      components: scope.components.map((c) => c.toJSON()),
                  }))
                : undefined,
            arrayField: this.arrayField,
        };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/searchParameters/searchParameterTypes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/searchParameters/searchParameterTypes.js src/tests/unit/searchParameters/searchParameterTypes.test.js
git commit -m "feat: add composite scopes/arrayField to SearchParameterDefinition"
```

---

### Task 2: Generator pass 2 — resolve composite `component[]` into `scopes[]`

**Files:**

- Modify: `generatorScripts/searchParameters/generate_search_parameters.py`
- Test: `generatorScripts/searchParameters/test_generate_search_parameters.py` (new)

**Interfaces:**

- Consumes: raw `fhir_schema["entry"]` (same source pass 1 reads), the `sample_dict: Dict[str, Dict[str, List[QueryEntry]]]` pass 1 already builds (keyed by resource, then search-parameter code).
- Produces: for every `type == 'composite'` entry, a rendered `'<code>': new SearchParameterDefinition({ type: 'composite', description: ..., scopes: [...] })` block written into `src/searchParameters/searchParameters.js`, using the `SearchParameterDefinition` shape from Task 1.

**Algorithm** (this is the generalization worked out in "Design Refinements" above — implement exactly this, not a per-composite special case table):

```python
import re

AS_CAST_RE = re.compile(r"^(?P<base>[\w.]*)\.as\((?P<cast>\w+)\)$")

def resolve_composite_component(
    component_expression: str,      # e.g. "code", "value.as(Quantity)", "%resource.referenceSeq.chromosome"
    definition_url: str,             # component["definition"]
    outer_resource: str,             # e.g. "MolecularSequence" (base resource of the composite)
    scope_array_path: str | None,    # e.g. "component", "variant", "relatesTo", or None for root scope
    all_array_paths_for_this_composite: list[str],  # e.g. ["component"] for combo-*, [] for root-only/array-only composites
    url_to_code: Dict[str, str],     # built once: {entry["resource"]["url"]: entry["resource"]["code"]}
    sample_dict: Dict[str, Dict[str, List[QueryEntry]]],
) -> QueryEntry:
    """Returns the single QueryEntry this component resolves to for this scope, or raises
    ValueError if it can't be resolved to exactly one."""

    # 1. %resource. override: always resolves against the resource root, regardless of this
    #    scope's own array path.
    if component_expression.startswith('%resource.'):
        relative_expr = component_expression[len('%resource.'):]
        effective_array_path = None
    else:
        relative_expr = component_expression
        effective_array_path = scope_array_path

    # 2. Detect a `.as(Type)` cast (polymorphic value[x] narrowing).
    cast_match = AS_CAST_RE.match(relative_expr)
    expected_leaf_suffix = None
    if cast_match:
        expected_leaf_suffix = cast_match.group('base') + cast_match.group('cast')  # e.g. "valueQuantity"

    # 3. Resolve definition URL -> code, then find that code's QueryEntry list for this resource
    #    (falling back to the generic 'Resource' bucket, same rule getPropertyObject uses).
    if definition_url not in url_to_code:
        raise ValueError(f"composite component definition URL {definition_url!r} does not resolve to any known SearchParameter code")
    referenced_code = url_to_code[definition_url]
    candidates = (
        sample_dict.get(outer_resource, {}).get(referenced_code)
        or sample_dict.get('Resource', {}).get(referenced_code)
    )
    if not candidates:
        raise ValueError(f"composite component code {referenced_code!r} (from {definition_url!r}) has no resolved field for resource {outer_resource!r}")

    # 4. Scope-filter: keep only candidates whose field lives under this scope's array path
    #    (or, for root scope, exclude fields that live under ANY of this composite's OTHER
    #    array paths -- e.g. exclude 'component.code' when resolving the root scope of a
    #    combo-* composite).
    if effective_array_path:
        prefix = effective_array_path + '.'
        scoped = [c for c in candidates if c.field.startswith(prefix)]
    else:
        other_prefixes = tuple(p + '.' for p in all_array_paths_for_this_composite)
        scoped = [c for c in candidates if not c.field.startswith(other_prefixes)]
    if not scoped:
        raise ValueError(f"composite component code {referenced_code!r} has no field matching scope (array_path={effective_array_path!r}) for resource {outer_resource!r}")

    # 5. Cast-filter: if more than one candidate remains (polymorphic value[x]), narrow to the
    #    one whose leaf field name (after stripping the array prefix) matches the FHIRPath cast.
    if len(scoped) > 1:
        if not expected_leaf_suffix:
            raise ValueError(f"composite component code {referenced_code!r} is ambiguous ({len(scoped)} candidates) for resource {outer_resource!r} and has no .as(Type) cast to disambiguate")
        def leaf(entry: QueryEntry) -> str:
            f = entry.field
            return f[len(effective_array_path) + 1:] if effective_array_path else f
        scoped = [c for c in scoped if leaf(c) == expected_leaf_suffix]
        if len(scoped) != 1:
            raise ValueError(f"composite component code {referenced_code!r} cast {expected_leaf_suffix!r} did not resolve to exactly one field for resource {outer_resource!r} (got {len(scoped)})")

    return scoped[0]
```

**Refactor first (avoids duplicating pass-1's loop in the test file):** extract `main()`'s existing
"for entry in entries: ... build query_entries ... group by Resource" block (everything from
`query_entries: List[QueryEntry] = []` down through `sample_dict['Binary'] = {}`) into a standalone
function:

```python
def build_sample_dict(entries: List[Dict[str, Any]], resource_field_types: Dict) -> Dict[str, Dict[str, List[QueryEntry]]]:
    """Pass 1: builds the per-resource, per-code table of regular QueryEntrys. This is the exact
    body that used to live inline in main() -- extracted unchanged so both main() and
    test_generate_search_parameters.py can call it without the test reimplementing pass 1."""
    query_entries: List[QueryEntry] = []
    print("search_parameter,base,code,status,type_,xpath,xpath_transformed,target,expression")
    entry: Dict[str, Any]
    for entry in entries:
        # ... unchanged body, exactly as it exists in main() today ...
        pass  # (implementer: move the existing loop body here verbatim, do not rewrite it)

    sample_dict: Dict[str, Dict[str, List[QueryEntry]]] = {}
    for query_entry in query_entries:
        add_values_in_dict(sample_dict=sample_dict, query_entry=query_entry)

    # for some reason Binary is missing
    sample_dict['Binary'] = {}
    return sample_dict
```

`main()` then becomes:

```python
def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")
    with open(data_dir.joinpath("search-parameters.json"), "r+") as file:
        contents = file.read()
    fhir_schema = json.loads(contents)
    entries: List[Dict[str, str]] = fhir_schema["entry"]
    resource_field_types = get_resources_fields_data()
    sample_dict = build_sample_dict(entries, resource_field_types)
    # ...rest of main() (field_filter_regex, writing searchParameters.js/search_parameters.py/
    # parameter files) is unchanged from here on, plus the new composite-scopes wiring below...
```

Now wire the new composite pass 2 into `main()`:

```python
def build_url_to_code_map(entries: List[Dict[str, Any]]) -> Dict[str, str]:
    return {entry["resource"]["url"]: entry["resource"]["code"] for entry in entries}


def build_composite_scopes(
    resource: Dict[str, Any],
    sample_dict: Dict[str, Dict[str, List[QueryEntry]]],
    url_to_code: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Returns [{'components': [QueryEntry-with-array_field, ...]}, ...] for one composite
    SearchParameter resource dict, one entry per '|'-separated scope in its own expression."""
    outer_resource = resource["base"][0]
    scope_exprs = [s.strip() for s in resource["expression"].split('|')]
    array_paths = []
    for scope_expr in scope_exprs:
        if scope_expr != outer_resource:
            assert scope_expr.startswith(outer_resource + '.'), f"unexpected composite scope {scope_expr!r} for base {outer_resource!r}"
            array_paths.append(scope_expr[len(outer_resource) + 1:])

    scopes = []
    for scope_expr in scope_exprs:
        array_path = None if scope_expr == outer_resource else scope_expr[len(outer_resource) + 1:]
        components = []
        for component in resource["component"]:
            resolved = resolve_composite_component(
                component_expression=component["expression"],
                definition_url=component["definition"],
                outer_resource=outer_resource,
                scope_array_path=array_path,
                all_array_paths_for_this_composite=array_paths,
                url_to_code=url_to_code,
                sample_dict=sample_dict,
            )
            effective_array_path = None if component["expression"].startswith('%resource.') else array_path
            relative_field = (
                resolved.field[len(effective_array_path) + 1:]
                if effective_array_path else resolved.field
            )
            components.append({
                'type_': resolved.type_,
                'field': relative_field,
                'array_field': effective_array_path,
                'target': resolved.target,  # needed by FilterByReference-typed components
                'field_type': resolved.field_type if resolved.type_ == 'date' else None,  # -> fieldTypesObj, needed by FilterByDateTime's period/timing branch
            })
        scopes.append({'components': components})
    return scopes
```

In `main()`, after the existing pass-1 loop finishes building `sample_dict` (right before the "# generate the file" comment), add:

```python
    url_to_code = build_url_to_code_map(entries)
    composite_scopes_by_resource_and_code: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        resource = entry["resource"]
        if resource.get("type") != "composite" or resource.get("status") not in ("active", "draft"):
            continue
        for base_resource in resource["base"]:
            composite_scopes_by_resource_and_code.setdefault(base_resource, {})[resource["code"]] = {
                'description': resource.get("description", ""),
                'scopes': build_composite_scopes(resource, sample_dict, url_to_code),
            }
```

Then extend `write_search_parameter_dict` to also emit these. Since composites don't fit the `List[QueryEntry]`-per-code shape `write_search_parameter_dict` iterates today, thread `composite_scopes_by_resource_and_code` through as a parameter and, per resource, after writing the regular `search_parameter_entries` loop, write one `new SearchParameterDefinition({...})` block per composite code:

```python
        composite_defs = composite_scopes_by_resource_and_code.get(resource, {})
        for code, composite_def in sorted(composite_defs.items()):
            cleaned_description = composite_def['description'].replace('\n', '').replace('\r', '').replace("'", "")
            if is_python:
                file2.write(f"\t\t'{code}': {{\n")
            else:
                file2.write(f"\t\t'{code}': new SearchParameterDefinition({{\n")
            file2.write(f"\t\t\t'description': '{cleaned_description}',\n")
            file2.write("\t\t\t'type': 'composite',\n")
            file2.write("\t\t\t'scopes': [\n")
            for scope in composite_def['scopes']:
                file2.write("\t\t\t\t{ 'components': [\n")
                for comp in scope['components']:
                    array_field_literal = f"'{comp['array_field']}'" if comp['array_field'] else 'null'
                    extra_fields = ""
                    if comp['target']:
                        target_list = ", ".join(f"'{t}'" for t in comp['target'])
                        extra_fields += f", 'target': [{target_list}]"
                    if comp['field_type']:
                        extra_fields += f", 'fieldTypesObj': {{ '{comp['field']}': '{comp['field_type'].lower()}' }}"
                    if is_python:
                        file2.write(f"\t\t\t\t\t{{ 'type': '{comp['type_']}', 'field': '{comp['field']}', 'array_field': {array_field_literal} }},\n")
                    else:
                        file2.write(f"\t\t\t\t\tnew SearchParameterDefinition({{ 'type': '{comp['type_']}', 'field': '{comp['field']}', 'arrayField': {array_field_literal}{extra_fields} }}),\n")
                file2.write("\t\t\t\t] },\n")
            file2.write("\t\t\t],\n")
            if is_python:
                file2.write("\t\t},\n")
            else:
                file2.write("\t\t}),\n")
```

Call `write_search_parameter_dict(field_filter_regex, file2, sample_dict, composite_scopes_by_resource_and_code, is_python=False)` (and the Python-file call) — update the function signature accordingly. Note: `sample_dict['Binary'] = {}` (existing line) means `composite_scopes_by_resource_and_code.get('Binary', {})` correctly yields nothing, no special-case needed.

**Fail loudly:** every `raise ValueError(...)` above is intentional — do not wrap `build_composite_scopes` in a try/except that swallows and skips. A composite that can't be resolved must fail `make searchParameters`, not silently produce a resource with a missing composite param.

- [ ] **Step 1: Write the failing tests**

```python
# generatorScripts/searchParameters/test_generate_search_parameters.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import generate_search_parameters as gsp  # noqa: E402

SEARCH_PARAMETERS_JSON = Path(__file__).parent / "search-parameters.json"


def _load_entries():
    with open(SEARCH_PARAMETERS_JSON) as f:
        return json.load(f)["entry"]


def _resource_field_types():
    from generatorScripts.generate_resource_fields_type import get_resources_fields_data
    return get_resources_fields_data()


def _build_sample_dict_and_url_map():
    # Reuses main()'s own pass-1 function (extracted as gsp.build_sample_dict in Step 3 below)
    # rather than reimplementing the xpath-parsing loop here -- this test must exercise the real
    # pass 1, not a second, drifting copy of it.
    entries = _load_entries()
    resource_field_types = _resource_field_types()
    sample_dict = gsp.build_sample_dict(entries, resource_field_types)
    return sample_dict, gsp.build_url_to_code_map(entries)


def _composite_resource(code):
    for entry in _load_entries():
        resource = entry["resource"]
        if resource.get("type") == "composite" and resource["code"] == code:
            return resource
    raise AssertionError(f"no composite entry with code {code!r}")


def test_root_only_composite_code_value_quantity():
    sample_dict, url_to_code = _build_sample_dict_and_url_map()
    resource = _composite_resource("code-value-quantity")
    scopes = gsp.build_composite_scopes(resource, sample_dict, url_to_code)
    assert len(scopes) == 1
    components = scopes[0]['components']
    assert components[0]['field'] == 'code'
    assert components[0]['array_field'] is None
    assert components[1]['field'] == 'valueQuantity'
    assert components[1]['array_field'] is None
    assert components[1]['type_'] == 'quantity'


def test_array_only_composite_component_code_value_quantity():
    sample_dict, url_to_code = _build_sample_dict_and_url_map()
    resource = _composite_resource("component-code-value-quantity")
    scopes = gsp.build_composite_scopes(resource, sample_dict, url_to_code)
    assert len(scopes) == 1
    components = scopes[0]['components']
    assert components[0]['field'] == 'code'
    assert components[0]['array_field'] == 'component'
    assert components[1]['field'] == 'valueQuantity'
    assert components[1]['array_field'] == 'component'


def test_or_of_scopes_composite_combo_code_value_quantity():
    sample_dict, url_to_code = _build_sample_dict_and_url_map()
    resource = _composite_resource("combo-code-value-quantity")
    scopes = gsp.build_composite_scopes(resource, sample_dict, url_to_code)
    assert len(scopes) == 2
    root_components, array_components = scopes[0]['components'], scopes[1]['components']
    assert root_components[0]['field'] == 'code' and root_components[0]['array_field'] is None
    assert root_components[1]['field'] == 'valueQuantity' and root_components[1]['array_field'] is None
    assert array_components[0]['field'] == 'code' and array_components[0]['array_field'] == 'component'
    assert array_components[1]['field'] == 'valueQuantity' and array_components[1]['array_field'] == 'component'


def test_genomics_composite_with_resource_override():
    sample_dict, url_to_code = _build_sample_dict_and_url_map()
    resource = _composite_resource("chromosome-variant-coordinate")
    scopes = gsp.build_composite_scopes(resource, sample_dict, url_to_code)
    assert len(scopes) == 1
    components = scopes[0]['components']
    assert components[0]['field'] == 'referenceSeq.chromosome'
    assert components[0]['array_field'] is None  # %resource. override always resolves to root
    assert components[1]['field'] == 'start' and components[1]['array_field'] == 'variant'
    assert components[2]['field'] == 'end' and components[2]['array_field'] == 'variant'


def test_unresolvable_definition_url_raises():
    sample_dict, url_to_code = _build_sample_dict_and_url_map()
    resource = _composite_resource("code-value-quantity")
    import copy
    broken = copy.deepcopy(resource)
    broken["component"][0]["definition"] = "http://hl7.org/fhir/SearchParameter/does-not-exist"
    try:
        gsp.build_composite_scopes(broken, sample_dict, url_to_code)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_all_composite_entries_resolve_to_valid_scopes():
    sample_dict, url_to_code = _build_sample_dict_and_url_map()
    entries = _load_entries()
    composite_entries = [e["resource"] for e in entries if e["resource"].get("type") == "composite"]
    assert len(composite_entries) == 46, f"expected 46 composite entries, found {len(composite_entries)}"
    failures = []
    for resource in composite_entries:
        try:
            scopes = gsp.build_composite_scopes(resource, sample_dict, url_to_code)
        except ValueError as e:
            failures.append(f"{resource['code']}: {e}")
            continue
        for scope in scopes:
            for comp in scope['components']:
                if not comp['field'] or not comp['type_']:
                    failures.append(f"{resource['code']}: component missing field/type: {comp}")
    assert not failures, "unresolved composite components:\n" + "\n".join(failures)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd generatorScripts/searchParameters && python3 -m pytest test_generate_search_parameters.py -v`
Expected: FAIL with `AttributeError: module 'generate_search_parameters' has no attribute 'build_sample_dict'` (and, once that's added, `build_composite_scopes`/`build_url_to_code_map` — expect a couple of iterations of "add the missing function, rerun, see the next missing one" before Step 3 is fully done).

- [ ] **Step 3: Implement**

1. Extract `main()`'s existing pass-1 loop into `build_sample_dict()` exactly as shown above (move the loop body verbatim — this is a pure extraction, not a rewrite — and update `main()` to call it).
2. Add `build_url_to_code_map()` and `resolve_composite_component()`/`build_composite_scopes()` exactly as specified above.
3. Wire the composite pass into `main()` and extend `write_search_parameter_dict()`, exactly as specified above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd generatorScripts/searchParameters && python3 -m pytest test_generate_search_parameters.py -v`
Expected: PASS. If `test_all_composite_entries_resolve_to_valid_scopes` fails on a composite not covered by the 5 targeted tests above, extend `resolve_composite_component`'s scope/cast-filter logic to handle the new shape it surfaces — do not special-case that one composite's code by hand.

- [ ] **Step 5: Regenerate and spot-check**

Run: `make searchParameters` (or the underlying `python3 generatorScripts/searchParameters/generate_search_parameters.py` if `make searchParameters` wraps more than needed — check the Makefile target first).

Then grep the output for one composite to confirm shape:

```bash
grep -A 20 "'code-value-quantity': new SearchParameterDefinition" src/searchParameters/searchParameters.js
```

Expected: a `type: 'composite'` block with a `scopes` array containing `field: 'code'` and `field: 'valueQuantity'` components, both `arrayField: null`.

- [ ] **Step 6: Commit**

```bash
git add generatorScripts/searchParameters/generate_search_parameters.py generatorScripts/searchParameters/test_generate_search_parameters.py src/searchParameters/searchParameters.js
git commit -m "feat: generate composite search parameter scopes from search-parameters.json"
```

---

### Task 3: `fhirFilterTypes.composite`

**Files:**

- Modify: `src/operations/query/customQueries.js`

**Interfaces:**

- Produces: `fhirFilterTypes.composite === 'composite'`, consumed by Task 4 (r4ArgsParser doesn't need it directly, but Task 5's `r4.js` switch does).

- [ ] **Step 1**: Add to the `fhirFilterTypes` object in `src/operations/query/customQueries.js`, after the `number` entry:

```js
/**
 * usage: ?param=componentValue1$componentValue2 (one $-joined part per component)
 */
composite: 'composite';
```

- [ ] **Step 2: Commit**

```bash
git add src/operations/query/customQueries.js
git commit -m "feat: add composite to fhirFilterTypes enum"
```

(No test file — this is a one-line enum addition exercised by Task 6's tests.)

---

### Task 4: `R4ArgsParser` resolves `fieldType` per composite component

**Files:**

- Modify: `src/operations/query/r4ArgsParser.js`
- Test: `src/tests/unit/operations/query/r4ArgsParser.test.js` (extend if it exists; check with `ls src/tests/unit/operations/query/r4ArgsParser.test.js` — if absent, create it minimally as below)

**Interfaces:**

- Consumes: `SearchParameterDefinition` with `.type === 'composite'` and `.scopes` (Task 1).
- Produces: after `parseArgs` runs, every component's `.fieldType` is populated (mutated in place, matching the existing pattern for the top-level `propertyObj.fieldType`), so `FilterByComposite` (Task 5) can rely on it being present without calling `FhirTypesManager` itself.

**Why here and not in `FilterByComposite`:** `R4SearchQueryCreator` (where `FilterByComposite` is instantiated) is not constructed with a `FhirTypesManager` — only `configManager`, `accessIndexManager`, `r4ArgsParser`. `R4ArgsParser` already has one and already does this exact resolution for the top-level `propertyObj`; extending that existing code path (rather than threading a new dependency into `R4SearchQueryCreator`) is the smaller, more consistent change.

- [ ] **Step 1: Write the failing test**

```js
// add to src/tests/unit/operations/query/r4ArgsParser.test.js (create if missing)
const { describe, test, expect } = require('@jest/globals');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { SearchParameterDefinition } = require('../../../../searchParameters/searchParameterTypes');
const { FhirTypesManager } = require('../../../../fhir/fhirTypesManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');

describe('R4ArgsParser composite fieldType resolution', () => {
    test('sets fieldType on every composite component after parseArgs', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const compositeDef = new SearchParameterDefinition({
            type: 'composite',
            scopes: [{ components: [component1, component2] }],
        });
        const searchParametersManager = new SearchParametersManager();
        searchParametersManager.getPropertyObject = () => compositeDef;

        const r4ArgsParser = new R4ArgsParser({
            fhirTypesManager: new FhirTypesManager(),
            configManager: new ConfigManager(),
            searchParametersManager,
        });

        r4ArgsParser.parseArgs({
            resourceType: 'Observation',
            args: { 'code-value-quantity': '8480-6$ge140' },
        });

        expect(component1.fieldType).toBe('CodeableConcept');
        expect(component2.fieldType).toBe('Quantity');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/r4ArgsParser.test.js -t "composite fieldType"`
Expected: FAIL — `component1.fieldType`/`component2.fieldType` are `undefined`.

- [ ] **Step 3: Implement**

In `src/operations/query/r4ArgsParser.js`, immediately after the existing block:

```js
// set type of field in propertyObj
propertyObj.fieldType =
    propertyObj.fields.length > 0
        ? this.fhirTypesManager.getTypeForField({
              resourceType,
              field: propertyObj.firstField,
          })
        : null;
```

add:

```js
// composite params resolve fieldType per component instead of on the top-level
// propertyObj (which has no field/fields of its own -- only scopes). Mutating each
// component in place mirrors the existing top-level fieldType assignment above;
// idempotent across requests since it depends only on resourceType + that
// component's own field.
if (propertyObj.type === 'composite' && propertyObj.scopes) {
    for (const scope of propertyObj.scopes) {
        for (const component of scope.components) {
            component.fieldType =
                component.fields.length > 0
                    ? this.fhirTypesManager.getTypeForField({
                          resourceType,
                          field: component.firstField,
                      })
                    : null;
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/r4ArgsParser.test.js -t "composite fieldType"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/operations/query/r4ArgsParser.js src/tests/unit/operations/query/r4ArgsParser.test.js
git commit -m "feat: resolve fieldType per composite component in R4ArgsParser"
```

---

### Task 5: `FilterByComposite`

**Files:**

- Create: `src/operations/query/filters/composite.js`
- Modify: `src/operations/query/r4.js`
- Test: `src/tests/unit/operations/query/filters/composite.test.js` (new)

**Interfaces:**

- Consumes: `FilterParameters{ propertyObj: SearchParameterDefinition (type='composite', scopes populated with fieldType set — Tasks 1 & 4), parsedArg: ParsedArgsItem, fieldMapper: FieldMapper, fnUseAccessIndex, resourceType }`. Reuses `FilterByToken`, `FilterByQuantity`, `FilterByDateTime`, `FilterByString`, `FilterByReference` (all `extends BaseFilter`, all expose `.filter(): Filter[]`) by constructing a standalone `FilterParameters` per component with a synthetic single-value `parsedArg`.
- Produces: `FilterByComposite.filter(): Filter[]` — same return shape every other filter class produces, consumed identically by `r4.js`'s existing `andSegments.forEach(q => totalAndSegments.push(q))` / `$nor`-wrapping logic. No changes needed there beyond the modifier guard and switch case below.

**Algorithm:**

```js
const { BadRequestError } = require('../../../utils/httpErrors');
const { BaseFilter } = require('./baseFilter');
const { FilterParameters } = require('./filterParameters');
const { FieldMapper } = require('./fieldMapper');
const { QueryParameterValue } = require('../queryParameterValue');
const { ParsedArgsItem } = require('../parsedArgsItem');
const { fhirFilterTypes } = require('../customQueries');
const { FilterByToken } = require('./token');
const { FilterByQuantity } = require('./quantity');
const { FilterByDateTime } = require('./dateTime');
const { FilterByString } = require('./string');
const { FilterByReference } = require('./reference');

const REJECTED_MODIFIERS = ['missing', 'contains', 'above', 'below', 'text', 'of-type'];

const FILTER_CLASS_BY_TYPE = {
    [fhirFilterTypes.token]: FilterByToken,
    [fhirFilterTypes.quantity]: FilterByQuantity,
    [fhirFilterTypes.date]: FilterByDateTime,
    [fhirFilterTypes.datetime]: FilterByDateTime,
    [fhirFilterTypes.instant]: FilterByDateTime,
    [fhirFilterTypes.period]: FilterByDateTime,
    [fhirFilterTypes.string]: FilterByString,
    [fhirFilterTypes.reference]: FilterByReference,
};

/**
 * @classdesc Filters by composite FHIR search parameters (type: 'composite').
 * https://www.hl7.org/fhir/search.html#composite
 *
 * A composite value is N '$'-separated parts, one per component of the *matching* scope (a
 * composite may declare more than one scope via its own '|'-joined expression, e.g.
 * 'Observation | Observation.component' for combo-*; every scope has the same component count,
 * so the value's '$' part count is checked against propertyObj.scopes[0].components.length).
 * Each part is filtered using the existing per-type filter class for that component (reusing
 * FilterByToken/FilterByQuantity/FilterByDateTime/FilterByString/FilterByReference exactly as
 * r4.js's own type switch does, via each class's public .filter() method) against a synthetic
 * single-component, single-value FilterParameters. Components sharing an array scope
 * (arrayField set) are combined into one $elemMatch per array field (never one $elemMatch per
 * component -- that would let each component match a *different* array element). Root-scoped
 * components are ANDed at the top level. Scopes are OR'd together.
 */
class FilterByComposite extends BaseFilter {
    filter() {
        const modifiers = this.parsedArg.modifiers || [];
        if (REJECTED_MODIFIERS.some((m) => modifiers.includes(m))) {
            throw new BadRequestError(
                new Error(
                    `Modifiers [${REJECTED_MODIFIERS.join(', ')}] are not supported on composite search ` +
                        `parameters (got: ${modifiers.join(', ')})`
                )
            );
        }
        if (modifiers.includes('exact')) {
            throw new BadRequestError(
                new Error("Modifier 'exact' is not supported on composite search parameters")
            );
        }

        const values = this.parsedArg.queryParameterValue.values || [];
        const operator = this.parsedArg.queryParameterValue.operator;
        const perValueConditions = values.map((value) => this.filterOneValue(value));
        if (perValueConditions.length === 0) {
            return [];
        }
        return [{ [operator]: perValueConditions }];
    }

    /**
     * @param {string} value one '$'-joined composite value, e.g. '8480-6$ge140'
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterOneValue(value) {
        const parts = value.split('$');
        const scopeConditions = this.propertyObj.scopes.map((scope) => {
            if (parts.length !== scope.components.length) {
                throw new BadRequestError(
                    new Error(
                        `Composite search parameter value '${value}' has ${parts.length} '$'-separated ` +
                            `part(s) but this parameter has ${scope.components.length} component(s)`
                    )
                );
            }
            return this.filterOneScope(scope, parts);
        });
        return scopeConditions.length > 1 ? { $or: scopeConditions } : scopeConditions[0];
    }

    /**
     * @param {{components: SearchParameterDefinition[]}} scope
     * @param {string[]} parts
     */
    filterOneScope(scope, parts) {
        const rootSegments = [];
        const segmentsByArrayField = new Map();

        scope.components.forEach((component, i) => {
            const segments = this.filterOneComponent(component, parts[i]);
            if (component.arrayField) {
                if (!segmentsByArrayField.has(component.arrayField)) {
                    segmentsByArrayField.set(component.arrayField, []);
                }
                segmentsByArrayField.get(component.arrayField).push(...segments);
            } else {
                rootSegments.push(...segments);
            }
        });

        const conditions = [...rootSegments];
        for (const [arrayField, segments] of segmentsByArrayField) {
            conditions.push({
                [this.fieldMapper.getFieldName(arrayField)]: {
                    $elemMatch: segments.length > 1 ? { $and: segments } : segments[0],
                },
            });
        }
        return conditions.length > 1 ? { $and: conditions } : conditions[0];
    }

    /**
     * @param {SearchParameterDefinition} component
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]} the andSegments
     *   .filter() returns for this one component/value pair
     */
    filterOneComponent(component, value) {
        const FilterClass = FILTER_CLASS_BY_TYPE[component.type];
        if (!FilterClass) {
            throw new Error(
                `Composite component type=${component.type} has no registered filter class`
            );
        }
        // array-scoped components must not carry the outer useHistoryTable prefix -- their
        // field is relative to the matched array element, applied exactly once via the
        // $elemMatch wrapper's own field name in filterOneScope, not per-component here.
        const componentFieldMapper = component.arrayField
            ? new FieldMapper({ useHistoryTable: false })
            : this.fieldMapper;
        const syntheticParsedArg = new ParsedArgsItem({
            queryParameter: component.firstField,
            queryParameterValue: new QueryParameterValue({ value, operator: '$and' }),
            propertyObj: component,
            modifiers: [],
        });
        const filterParameters = new FilterParameters({
            propertyObj: component,
            parsedArg: syntheticParsedArg,
            fieldMapper: componentFieldMapper,
            fnUseAccessIndex: this.fnUseAccessIndex,
            resourceType: this.resourceType,
        });
        return new FilterClass(filterParameters).filter();
    }
}

module.exports = {
    FilterByComposite,
};
```

Then in `src/operations/query/r4.js`:

1. Add the import: `const { FilterByComposite } = require('./filters/composite');`
2. In `buildR4SearchQuery`'s modifier-dispatch chain, **before** the existing `if (parsedArg.modifiers.includes('missing'))`, add:
    ```js
    if (parsedArg.propertyObj.type === fhirFilterTypes.composite &&
        ['missing', 'contains', 'above', 'below', 'text', 'of-type'].some(m => parsedArg.modifiers.includes(m))) {
        throw new BadRequestError(new Error(
            `Modifiers [missing, contains, above, below, text, of-type] are not supported on composite search parameters (queryParameter=${parsedArg.queryParameter})`
        ));
    } else if (parsedArg.modifiers.includes('missing')) {
    ```
    (i.e. fold the new check into the existing `if`/`else if` chain as its first branch, changing the existing `if` to `else if`). This needs `const { BadRequestError } = require('../../utils/httpErrors');` added to `r4.js`'s imports if not already present — check first with `grep -n BadRequestError src/operations/query/r4.js`.
3. In `getColumnsAndSegmentsForParameterType`'s switch, add before `default:`:
    ```js
                 case fhirFilterTypes.composite:
                     andSegments = new FilterByComposite(filterParameters).filter();
                     break;
    ```

- [ ] **Step 1: Write the failing tests**

```js
// src/tests/unit/operations/query/filters/composite.test.js
const { describe, test, expect } = require('@jest/globals');
const { FilterByComposite } = require('../../../../../operations/query/filters/composite');
const { FilterParameters } = require('../../../../../operations/query/filters/filterParameters');
const { FieldMapper } = require('../../../../../operations/query/filters/fieldMapper');
const {
    SearchParameterDefinition,
} = require('../../../../../searchParameters/searchParameterTypes');
const { ParsedArgsItem } = require('../../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../../operations/query/queryParameterValue');
const { BadRequestError } = require('../../../../../utils/httpErrors');

function makeComposite(scopes) {
    return new SearchParameterDefinition({ type: 'composite', scopes });
}

function makeFilter(propertyObj, { value, modifiers = [], useHistoryTable = false } = {}) {
    const parsedArg = new ParsedArgsItem({
        queryParameter: 'test-composite',
        queryParameterValue: new QueryParameterValue({ value }),
        propertyObj,
        modifiers,
    });
    return new FilterByComposite(
        new FilterParameters({
            propertyObj,
            parsedArg,
            fieldMapper: new FieldMapper({ useHistoryTable }),
            fnUseAccessIndex: () => false,
            resourceType: 'Observation',
        })
    );
}

describe('FilterByComposite', () => {
    test('root-only AND: both components at the top level, no $elemMatch', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept',
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        const result = makeFilter(composite, { value: '8480-6$ge140' }).filter();
        expect(result).toHaveLength(1);
        const [
            {
                $and: [andSegments],
            },
        ] = result;
        expect(JSON.stringify(andSegments)).not.toMatch(/\$elemMatch/);
    });

    test('array-only: components wrapped in a single $elemMatch on the shared array field', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'component',
            fieldType: 'CodeableConcept',
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'component',
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        const result = makeFilter(composite, { value: '8480-6$ge140' }).filter();
        const [
            {
                $and: [andSegments],
            },
        ] = result;
        expect(andSegments.component.$elemMatch).toBeDefined();
        expect(andSegments.component.$elemMatch.$and).toHaveLength(2);
    });

    test('OR-of-scopes: root scope OR array scope', () => {
        const rootCode = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept',
        });
        const rootValue = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const arrayCode = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'component',
            fieldType: 'CodeableConcept',
        });
        const arrayValue = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'component',
        });
        const composite = makeComposite([
            { components: [rootCode, rootValue] },
            { components: [arrayCode, arrayValue] },
        ]);
        const result = makeFilter(composite, { value: '8480-6$ge140' }).filter();
        const [
            {
                $and: [{ $or: scopeConditions }],
            },
        ] = result;
        expect(scopeConditions).toHaveLength(2);
    });

    test('%resource. override / genomics 3-component shape: root component + 2 array components', () => {
        const chromosome = new SearchParameterDefinition({
            type: 'token',
            field: 'referenceSeq.chromosome',
            fieldType: 'string',
        });
        const start = new SearchParameterDefinition({
            type: 'number',
            field: 'start',
            arrayField: 'variant',
        });
        const end = new SearchParameterDefinition({
            type: 'number',
            field: 'end',
            arrayField: 'variant',
        });
        const composite = makeComposite([{ components: [chromosome, start, end] }]);
        const result = makeFilter(composite, { value: '1$123$345' }).filter();
        const [
            {
                $and: [andSegments],
            },
        ] = result;
        expect(andSegments.variant.$elemMatch.$and).toHaveLength(2);
    });

    test('mismatched $-part count throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expect(() => makeFilter(composite, { value: 'only-one-part' }).filter()).toThrow(
            BadRequestError
        );
    });

    test('rejected modifier (contains) throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expect(() =>
            makeFilter(composite, { value: 'a$b', modifiers: ['contains'] }).filter()
        ).toThrow(BadRequestError);
    });

    test('rejected modifier (exact) throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expect(() =>
            makeFilter(composite, { value: 'a$b', modifiers: ['exact'] }).filter()
        ).toThrow(BadRequestError);
    });

    test('useHistoryTable prefixes the array field once, not the fields inside $elemMatch', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'component',
            fieldType: 'CodeableConcept',
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'component',
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        const result = makeFilter(composite, {
            value: '8480-6$ge140',
            useHistoryTable: true,
        }).filter();
        const [
            {
                $and: [andSegments],
            },
        ] = result;
        expect(andSegments['resource.component']).toBeDefined();
        expect(andSegments.component).toBeUndefined();
        expect(JSON.stringify(andSegments['resource.component'])).not.toMatch(/resource\.code/);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/filters/composite.test.js`
Expected: FAIL — `Cannot find module '../../../../../operations/query/filters/composite'`.

- [ ] **Step 3: Implement** `src/operations/query/filters/composite.js` and the `r4.js` edits exactly as specified above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/filters/composite.test.js`
Expected: PASS. If the exact shape of `result[0]` differs from what a test's destructuring assumes (e.g. `$and` wrapping when there's only one condition), adjust the test's destructuring to match `filter()`'s actual documented return shape — do not change `filter()` to match an assumption made before running it.

- [ ] **Step 5: Run the full unit suite for regressions**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/`
Expected: PASS (confirms the `r4.js` modifier-dispatch reordering didn't break existing non-composite modifier handling).

- [ ] **Step 6: Commit**

```bash
git add src/operations/query/filters/composite.js src/operations/query/r4.js src/tests/unit/operations/query/filters/composite.test.js
git commit -m "feat: implement FilterByComposite and wire it into R4SearchQueryCreator"
```

---

### Task 6: End-to-end tests (REST + MCP)

**Files:**

- Create: `src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js`
- Create: `src/tests/integration/searchParameters/search_by_composite/fixtures/observation/observation1.json`
- Create: `src/tests/integration/searchParameters/search_by_composite/fixtures/observation/observation2.json`

**Interfaces:**

- Consumes: the full stack from Tasks 1–5, `make searchParameters` output from Task 2, `callMcpTool`/`bundleFromToolResult` from `src/tests/integration/mcp/mcpTestHelpers.js`.
- Produces: proof the feature works through both REST and MCP with zero MCP-specific code, and a regression test proving the old silent no-op is gone.

**Fixtures:** two Observations, same `code`, different `component[].code`/`component[].valueQuantity`, so `code-value-quantity` (root, matches both — same top-level `code`/`value`) and `component-code-value-quantity` (array, `$elemMatch` — must distinguish them by which _pair_ is in the _same_ component) can be told apart:

```json
// fixtures/observation/observation1.json
{
    "resourceType": "Observation",
    "id": "composite-search-obs-1",
    "meta": {
        "source": "test",
        "security": [
            { "system": "https://www.icanbwell.com/owner", "code": "A" },
            { "system": "https://www.icanbwell.com/access", "code": "A" }
        ]
    },
    "status": "final",
    "code": { "coding": [{ "system": "http://loinc.org", "code": "55284-4" }] },
    "subject": { "reference": "Patient/composite-search-patient" },
    "component": [
        {
            "code": { "coding": [{ "system": "http://loinc.org", "code": "8480-6" }] },
            "valueQuantity": {
                "value": 150,
                "unit": "mm[Hg]",
                "system": "http://unitsofmeasure.org",
                "code": "mm[Hg]"
            }
        },
        {
            "code": { "coding": [{ "system": "http://loinc.org", "code": "8462-4" }] },
            "valueQuantity": {
                "value": 75,
                "unit": "mm[Hg]",
                "system": "http://unitsofmeasure.org",
                "code": "mm[Hg]"
            }
        }
    ]
}
```

```json
// fixtures/observation/observation2.json
{
    "resourceType": "Observation",
    "id": "composite-search-obs-2",
    "meta": {
        "source": "test",
        "security": [
            { "system": "https://www.icanbwell.com/owner", "code": "A" },
            { "system": "https://www.icanbwell.com/access", "code": "A" }
        ]
    },
    "status": "final",
    "code": { "coding": [{ "system": "http://loinc.org", "code": "55284-4" }] },
    "subject": { "reference": "Patient/composite-search-patient" },
    "component": [
        {
            "code": { "coding": [{ "system": "http://loinc.org", "code": "8480-6" }] },
            "valueQuantity": {
                "value": 90,
                "unit": "mm[Hg]",
                "system": "http://unitsofmeasure.org",
                "code": "mm[Hg]"
            }
        },
        {
            "code": { "coding": [{ "system": "http://loinc.org", "code": "8462-4" }] },
            "valueQuantity": {
                "value": 150,
                "unit": "mm[Hg]",
                "system": "http://unitsofmeasure.org",
                "code": "mm[Hg]"
            }
        }
    ]
}
```

Observation1 has `8480-6` paired with `150`; observation2 has `8480-6` paired with `90` (and `8462-4` paired with `150` instead). So `component-code-value-quantity=8480-6$ge140` matches observation1 only (its `8480-6` component has value 150 ≥ 140) even though observation2 _also_ contains a component with value ≥140 elsewhere (`8462-4`/150) — proving `$elemMatch` pairing, not independent per-field matching. `code-value-quantity=55284-4$ge0` (root scope, both observations' top-level `code`/no top-level `valueQuantity` — use a root-level scenario instead, see test below for the actual root-scope assertion using `clinical-code`-style top-level fields) — see Step 1 for the precise assertions actually used.

- [ ] **Step 1: Write the tests**

```js
// src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    getFullAccessToken,
    createTestRequest,
} = require('../../common');
const { callMcpTool, bundleFromToolResult, idsInBundle } = require('../../mcp/mcpTestHelpers');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Composite search parameter tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    async function createBothObservations(request) {
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
    }

    test('component-code-value-quantity ($elemMatch) narrows by pairing, not independent fields', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        const resp = await request
            .get('/4_0_0/Observation?component-code-value-quantity=8480-6$ge140&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.statusCode).toBe(200);
        const ids = (resp.body.entry || []).map((e) => e.resource.id);
        expect(ids).toEqual(['composite-search-obs-1']);
    });

    test('code-value-quantity (root AND) matches on the top-level code+value pair', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        // Neither fixture has a top-level valueQuantity, so a root-scope match requires adding
        // one to a third fixture-like payload inline here rather than reusing observation1/2
        // (which are built specifically to exercise the $elemMatch pairing test above).
        const rootObservation = {
            ...observation1Resource,
            id: 'composite-search-obs-root',
            component: undefined,
            valueQuantity: {
                value: 200,
                unit: 'mm[Hg]',
                system: 'http://unitsofmeasure.org',
                code: 'mm[Hg]',
            },
        };
        let resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(rootObservation)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get('/4_0_0/Observation?code-value-quantity=55284-4$ge140&_bundle=1')
            .set(getHeadersWithAdmin());
        const ids = (resp.body.entry || []).map((e) => e.resource.id);
        expect(ids).toEqual(['composite-search-obs-root']);
    });

    test('regression: composite param actually filters (old behavior silently returned everything)', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        // A value that matches NEITHER observation's component pairing must return zero results.
        // Before this feature, composite params were silently dropped from the query entirely,
        // so this would have returned both observations regardless of the value.
        const resp = await request
            .get('/4_0_0/Observation?component-code-value-quantity=8480-6$ge9999&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.body.entry || []).toHaveLength(0);
    });

    test('MCP search_observation tool applies composite filtering with zero tool-specific code', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);
        const bearerToken = await getFullAccessToken();

        const { rpc } = await callMcpTool(request, bearerToken, 'search_observation', {
            'component-code-value-quantity': '8480-6$ge140',
        });
        const bundle = bundleFromToolResult(rpc);
        expect(idsInBundle(bundle)).toEqual(['composite-search-obs-1']);
    });

    test('rejected modifier on a composite param returns 400, not a silent empty/wrong result', async () => {
        const request = await createTestRequest();
        await createBothObservations(request);

        const resp = await request
            .get('/4_0_0/Observation?component-code-value-quantity:contains=8480-6$ge140&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.statusCode).toBe(400);
    });
});
```

Before finalizing, confirm `getFullAccessToken` is the right helper for `search_observation`'s required scopes (check its usage in `dedicatedTools.test.js`'s `search_observation` test, Task-adjacent file already read during planning) and that `component-code-value-quantity` is on `Observation`'s MCP tool schema already (it will be, automatically, once `make searchParameters` regenerates and `generate_mcp_tools.py` re-reads `search-parameters.json` — no MCP-specific change needed, confirming the design's "Out of Scope" claim).

- [ ] **Step 2: Run and verify**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js`
Expected: PASS. If the MCP test fails because `search_observation`'s generated schema doesn't yet include `component-code-value-quantity` as a field name, re-run `make searchParameters` (Task 2, Step 5) and regenerate MCP tool files (check the Makefile for the MCP-generation target — likely part of `make generate`) before re-running.

- [ ] **Step 3: Commit**

```bash
git add src/tests/integration/searchParameters/search_by_composite/
git commit -m "test: add end-to-end REST/MCP coverage for composite search parameters"
```

---

### Task 7: MCP `TYPE_VALUE_SYNTAX_HINTS['composite']`

**Files:**

- Modify: `generatorScripts/mcp/generate_mcp_tools.py`
- Modify: `generatorScripts/mcp/test_generate_mcp_tools.py`

**Interfaces:**

- Consumes: nothing from earlier tasks (independent of the JS-side work — this only affects generated tool-schema descriptions).
- Produces: `src/mcp/typeValueSyntaxHints.js`'s `TYPE_VALUE_SYNTAX_HINTS.composite`, and every composite field in every generated `src/mcp/tools/*.tool.js` gets a real value-syntax hint instead of none.

- [ ] **Step 1: Write the failing test**

Add to `generatorScripts/mcp/test_generate_mcp_tools.py`:

```python
def test_format_mcp_description_includes_composite_syntax_hint():
    param = {"code": "code-value-quantity", "type": "composite", "description": "Code and quantity value parameter pair", "target": []}
    result = generate_mcp_tools.format_mcp_description(param, "Observation")
    assert "$" in result
    assert "composite" in result  # the '(composite)' type suffix
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd generatorScripts/mcp && python3 -m pytest test_generate_mcp_tools.py -v -k composite`
Expected: FAIL — result has no `$`-format guidance (currently `format_mcp_description` finds no `TYPE_VALUE_SYNTAX_HINTS.get('composite')`, so `syntax_hint` is `None` and nothing is appended).

- [ ] **Step 3: Implement**

In `generatorScripts/mcp/generate_mcp_tools.py`, add to `TYPE_VALUE_SYNTAX_HINTS`, after `"canonical"`:

```python
    "composite": "Format: '$'-joined value, one part per component in order (e.g. 'code$value' for a 2-component pair, or 'code$value$value' for a 3-component pair). Comma-separate multiple '$'-joined pairs to OR them, same as any other parameter.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd generatorScripts/mcp && python3 -m pytest test_generate_mcp_tools.py -v`
Expected: PASS (full file, to confirm no other test broke).

- [ ] **Step 5: Regenerate and spot-check**

Run: `make generate` (or the specific MCP-generation Makefile target — check `Makefile` for what invokes `generate_mcp_tools.py`).

```bash
grep "'composite'" src/mcp/typeValueSyntaxHints.js
grep -A2 "code-value-quantity" src/mcp/tools/observation.tool.js | head -5
```

Expected: `typeValueSyntaxHints.js` has the new `composite` key; `observation.tool.js`'s `code-value-quantity` field description now ends with the `$`-format hint instead of just `(composite)`.

- [ ] **Step 6: Commit**

```bash
git add generatorScripts/mcp/generate_mcp_tools.py generatorScripts/mcp/test_generate_mcp_tools.py src/mcp/typeValueSyntaxHints.js src/mcp/tools/
git commit -m "feat: add composite value-syntax hint to generated MCP tool schemas"
```

---

## Execution Order

Tasks 1 → 2 → 3 → 4 → 5 → 6 are a strict dependency chain (each needs the previous task's output to test against real data). Task 7 is independent and can run any time after Task 2 (it only needs `search-parameters.json` to still contain composite entries, which it always does) — in parallel with Tasks 3–6 if using subagent-driven development.

## Out of Scope (carried over from the spec, still true)

- `McpToolHandler`, `SearchBundleOperation`, GraphQL resolvers, REST route handlers — untouched; Task 6's MCP test is the proof, not new code there.
- The ClickHouse-backed analytics search path.
- Escaping a literal `$` within one component's own value.
