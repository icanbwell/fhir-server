# This file has the code generator to reach search-parameters.json and generate searchParameters.js

import json
import os
import shutil
import re
from dataclasses import dataclass
from dataclasses import replace
from pathlib import Path
from re import Match
import sys
from typing import Any
from typing import Dict
from typing import List
from typing import Optional
from typing import Union

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.generate_resource_fields_type import get_resources_fields_data


@dataclass
class QueryEntry:
    resource: str
    search_parameter: str
    type_: str
    field: str
    target: Optional[List[str]]
    description: Optional[str]
    definition: Optional[str]
    field_type: Optional[str]


def add_values_in_dict(sample_dict: Dict[str, Dict[str, List[QueryEntry]]], query_entry: QueryEntry):
    """ Append multiple values to a key in
        the given dictionary """
    if query_entry.resource not in sample_dict:
        sample_dict[query_entry.resource] = dict()
    if query_entry.search_parameter not in sample_dict[query_entry.resource]:
        sample_dict[query_entry.resource][query_entry.search_parameter] = list()
    sample_dict[query_entry.resource][query_entry.search_parameter].append(query_entry)
    return sample_dict


def build_sample_dict(entries: List[Dict[str, Any]], resource_field_types: Dict) -> Dict[str, Dict[str, List[QueryEntry]]]:
    """ Pass 1: builds the per-resource, per-code table of regular QueryEntrys. This is the exact
        body that used to live inline in main() -- extracted unchanged so both main() and
        test_generate_search_parameters.py can call it without the test reimplementing pass 1. """
    query_entries: List[QueryEntry] = []
    print("search_parameter,base,code,status,type_,xpath,xpath_transformed,target,expression")
    entry: Dict[str, Any]
    for entry in entries:
        resource: Dict[str, Any] = entry["resource"]
        search_parameter: str = resource["name"]
        code: str = resource["code"]
        status: str = resource["status"]
        description: str = resource["description"]
        type_: str = resource["type"]
        base: str = "|".join(resource["base"])
        expression: str = resource.get("expression", None)
        xpath: str = resource.get("xpath", None)
        definition: str = resource.get("url", None)
        if resource["id"] in ["individual-given", "individual-family"]:
            parameter_name = resource["id"].split("-")[-1]
            base += "|Person"
            expression += f" | Person.name.{parameter_name}"
            xpath += f" | f:Person/f:name/f:{parameter_name}"
            description += f"* [Person](person.html): A portion of the {parameter_name} name of the person\r\n"

        xpath_transformed: str = xpath.replace("/f:", ".").replace("f:", "") if xpath else None
        target: str = "|".join(resource["target"]) if "target" in resource else None
        print(f"{search_parameter},{base},{code},{status},{type_},{xpath},{xpath_transformed},{target},{expression}")
        if xpath_transformed:
            exp: str
            for exp in xpath_transformed.split("|"):
                exp = exp.strip(" ")
                resource1, exp1 = exp.split(".", 1)
                field_type = resource_field_types.get(exp, {}).get("code", None)
                if field_type is None:
                    if resource1 == "Resource" and exp1 == "meta.lastUpdated":
                        field_type = "instant"
                    if resource1 == "MedicationRequest" and exp1 == "dosageInstruction.timing.event":
                        field_type = "datetime"
                query_entry: QueryEntry = QueryEntry(
                    resource=resource1,
                    search_parameter=search_parameter,
                    type_=type_,
                    field=exp1,
                    field_type=field_type,
                    target=target.split("|") if target else None,
                    description=description,
                    definition=definition
                )

                ############
                # For custom param on period field in certain resources
                ############

                if (
                    resource1
                    in [
                        "Encounter",
                        "Condition",
                        "DiagnosticReport",
                        "Observation",
                        "Procedure",
                    ]
                    and query_entry.type_ == "date"
                    and query_entry.field_type
                    and query_entry.field_type.lower() == "period"
                ):
                    # remove . from field name and convert to camel case for param name except first part
                    param_name_parts = query_entry.field.split(".")
                    param_name = param_name_parts[0] + "".join(part.capitalize() for part in param_name_parts[1:])

                    # create start and end date entries
                    start_entry: QueryEntry = QueryEntry(
                        resource=query_entry.resource,
                        search_parameter=f"_{param_name}Start",
                        type_=query_entry.type_,
                        field=query_entry.field + ".start",
                        field_type="datetime",
                        target=query_entry.target,
                        description="Custom search parameter for start date of " + query_entry.field,
                        definition=query_entry.definition
                    )
                    end_entry: QueryEntry = QueryEntry(
                        resource=query_entry.resource,
                        search_parameter=f"_{param_name}End",
                        type_=query_entry.type_,
                        field=query_entry.field + ".end",
                        field_type="datetime",
                        target=query_entry.target,
                        description="Custom search parameter for end date of " + query_entry.field,
                        definition=query_entry.definition
                    )
                    query_entries.append(start_entry)
                    query_entries.append(end_entry)
                query_entries.append(query_entry)

    # group by Resource
    sample_dict: Dict[str, Dict[str, List[QueryEntry]]] = {}
    for query_entry in query_entries:
        add_values_in_dict(sample_dict=sample_dict, query_entry=query_entry)

    # for some reason Binary is missing
    sample_dict['Binary'] = {}
    return sample_dict


def build_url_to_code_map(entries: List[Dict[str, Any]]) -> Dict[str, str]:
    return {entry["resource"]["url"]: entry["resource"]["code"] for entry in entries}


AS_CAST_RE = re.compile(r"^\(?(?P<base>[\w.]*)(?:\.as\((?P<cast_dot>\w+)\)|\s+as\s+(?P<cast_as>\w+))\)?$")


def _parse_cast_alternatives(expr: str) -> List[str]:
    """Parses a FHIRPath expression that may be a '|'-separated union of polymorphic value[x]
    casts -- either the dotted `base.as(Type)` form or the parenthesised `(base as Type)` form
    -- into a list of expected leaf field-name suffixes (e.g. 'valueQuantity'), in the order
    they're declared. FHIRPath primitive-type casts are lower-case (`.as(string)`) but the
    generated element name is capitalized (`valueString`), so the cast's first letter is
    upper-cased; anything after it is left untouched (so `CodeableConcept` isn't mangled).
    Returns [] if expr has no recognizable cast at all (e.g. a plain field path)."""
    alternatives = []
    for alt in expr.split('|'):
        alt = alt.strip()
        cast_match = AS_CAST_RE.match(alt)
        if not cast_match:
            continue
        base = cast_match.group('base')
        cast = cast_match.group('cast_dot') or cast_match.group('cast_as')
        alternatives.append(base + cast[0].upper() + cast[1:])
    return alternatives


def _field_type_info(resource_name: str, dotted_path: str, resource_field_types: Dict) -> Optional[Dict]:
    return resource_field_types.get(f"{resource_name}.{dotted_path}")


def _is_true_array_path(resource_name: str, array_path: str, resource_field_types: Dict) -> bool:
    """Only trust a scope's array path as a genuine repeating array (max cardinality '*') if
    resource_field_types confirms it. A few composite scopes name a singular (0..1/1..1) element
    instead -- e.g. MolecularSequence.referenceSeq is max '1', not a repeating BackboneElement --
    and those must be treated as root-equivalent (no $elemMatch-style array scope).

    Raises ValueError if resource_field_types has no entry at all for
    "<resource_name>.<array_path>" -- unlike a confirmed max != '*' (a real, legitimate
    singular-element case), a missing lookup means we have no evidence either way, and silently
    treating that as "not an array" would collapse a genuine array scope to root-equivalent,
    dropping the $elemMatch correlation between components and letting them silently match
    different array elements."""
    field_info = _field_type_info(resource_name, array_path, resource_field_types)
    if not field_info:
        raise ValueError(
            f"_is_true_array_path: no resource_field_types entry for "
            f"{resource_name!r}.{array_path!r} -- cannot determine array cardinality"
        )
    return field_info.get('max') == '*'


def _array_path_is_backbone(resource_name: str, array_path: str, resource_field_types: Dict) -> bool:
    """True only if the array path's own element type is BackboneElement, meaning its sub-fields
    are themselves directly enumerated in resource_field_types (which only parses
    profiles-resources.xml, i.e. resource-level and BackboneElement-nested elements -- it never
    descends into complex datatypes like UsageContext, Range, etc.). Used to decide whether an
    absent synthesized sub-path is trustworthy evidence of a bogus path, or just a datatype whose
    internals resource_field_types was never going to have."""
    field_info = _field_type_info(resource_name, array_path, resource_field_types)
    return bool(field_info) and field_info.get('code') == 'BackboneElement'


def resolve_composite_component(
    component_expression: str,      # e.g. "code", "value.as(Quantity)", "%resource.referenceSeq.chromosome"
    definition_url: str,             # component["definition"]
    outer_resource: str,             # e.g. "MolecularSequence" (base resource of the composite)
    scope_array_path: Optional[str],    # e.g. "component", "variant", "relatesTo", or None for root scope
    all_array_paths_for_this_composite: List[str],  # e.g. ["component"] for combo-*, [] for root-only/array-only composites
    url_to_code: Dict[str, str],     # built once: {entry["resource"]["url"]: entry["resource"]["code"]}
    sample_dict: Dict[str, Dict[str, List[QueryEntry]]],
    resource_field_types: Dict,      # from get_resources_fields_data(): "<Resource>.<dotted.path>" -> {code, min, max}
) -> Union[QueryEntry, List[QueryEntry]]:
    """Returns the QueryEntry this component resolves to for this scope, or -- when a component's
    expression is a union of 2+ polymorphic `.as(Type)` casts that EACH resolve to exactly one
    live candidate (e.g. 'value.as(Quantity) | value.as(Range)' where both Quantity and Range
    fields genuinely exist) -- a LIST of the QueryEntrys for all of them, so the caller can render
    a plural fields[]/fieldTypesObj instead of silently dropping every alternative but one.
    Raises ValueError if it can't be resolved to at least one."""

    # 1. %resource. override: always resolves against the resource root, regardless of this
    #    scope's own array path.
    if component_expression.startswith('%resource.'):
        relative_expr = component_expression[len('%resource.'):]
        effective_array_path = None
    else:
        relative_expr = component_expression
        effective_array_path = scope_array_path

    # 2. Detect polymorphic value[x] cast(s). A component expression may itself be a
    #    '|'-separated union of casts (e.g. 'value.as(Quantity) | value.as(Range)', or the
    #    parenthesised '(value as CodeableConcept) | (value as boolean)' form) when the
    #    underlying non-composite SearchParameter covers more than one representation but the
    #    composite component only wants a single field. expected_leaf_suffixes preserves the
    #    alternatives in the order they're declared so step 5 can prefer the earliest one that
    #    actually has a live candidate field.
    expected_leaf_suffixes = _parse_cast_alternatives(relative_expr)

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
        if not scoped:
            # Data quirk: some SearchParameter entries (e.g. Observation-combo-value-quantity)
            # only ever populate the resource-root xpath for a polymorphic value[x], even
            # though the composite also scopes the same component under an array path (e.g.
            # 'component') -- the FHIR spec's xpath for those codes is a flat copy of the root
            # variant's xpath and was never updated to add the array-scoped fields. If NONE of
            # this code's candidates are scoped under ANY of this composite's array paths, the
            # candidate list is flat/unscoped, so treat every candidate as already relative to
            # this array scope by rewriting its field to carry the expected prefix.
            other_prefixes = tuple(p + '.' for p in all_array_paths_for_this_composite)
            if not any(c.field.startswith(other_prefixes) for c in candidates):
                synthesized = [replace(c, field=prefix + c.field) for c in candidates]
                if _array_path_is_backbone(outer_resource, effective_array_path, resource_field_types):
                    # Guard against synthesizing a path that doesn't actually exist on this
                    # BackboneElement -- resource_field_types enumerates BackboneElement
                    # sub-fields directly, so absence here IS evidence of a bogus path. Skip
                    # this check entirely when the array path's own type isn't a BackboneElement
                    # (e.g. UsageContext, Range) -- resource_field_types never has datatype
                    # internals, so absence there proves nothing.
                    synthesized = [
                        c for c in synthesized
                        if _field_type_info(outer_resource, c.field, resource_field_types) is not None
                    ]
                scoped = synthesized
    else:
        other_prefixes = tuple(p + '.' for p in all_array_paths_for_this_composite)
        scoped = [c for c in candidates if not c.field.startswith(other_prefixes)]
    if not scoped:
        raise ValueError(f"composite component code {referenced_code!r} has no field matching scope (array_path={effective_array_path!r}) for resource {outer_resource!r}")

    # 5. Cast-filter: if more than one candidate remains (polymorphic value[x]), match each
    #    declared `.as(Type)` alternative to the (at most one) candidate whose leaf field name
    #    (after stripping the array prefix) matches it. If exactly ONE alternative resolves,
    #    return that single field (the common case). If MULTIPLE alternatives each resolve to
    #    exactly one live candidate (e.g. 'value.as(Quantity) | value.as(Range)' where both a
    #    Quantity and a Range field genuinely exist for this resource), return ALL of them --
    #    the caller renders a plural fields[]/fieldTypesObj instead of silently keeping only one
    #    and dropping real, matchable data.
    if len(scoped) > 1:
        if not expected_leaf_suffixes:
            raise ValueError(f"composite component code {referenced_code!r} is ambiguous ({len(scoped)} candidates) for resource {outer_resource!r} and has no .as(Type) cast to disambiguate")
        def leaf(entry: QueryEntry) -> str:
            f = entry.field
            return f[len(effective_array_path) + 1:] if effective_array_path else f
        resolved_alternatives: List[QueryEntry] = []
        for expected_leaf_suffix in expected_leaf_suffixes:
            matching = [c for c in scoped if leaf(c) == expected_leaf_suffix]
            if len(matching) == 1:
                resolved_alternatives.append(matching[0])
            elif len(matching) > 1:
                raise ValueError(f"composite component code {referenced_code!r} cast {expected_leaf_suffix!r} matched {len(matching)} candidates (expected at most 1) for resource {outer_resource!r}")
        if not resolved_alternatives:
            raise ValueError(f"composite component code {referenced_code!r} cast(s) {expected_leaf_suffixes!r} did not resolve to exactly one field for resource {outer_resource!r} (got {len(scoped)} candidates)")
        return resolved_alternatives[0] if len(resolved_alternatives) == 1 else resolved_alternatives

    return scoped[0]


def build_composite_scopes(
    resource: Dict[str, Any],
    base_resource: str,
    sample_dict: Dict[str, Dict[str, List[QueryEntry]]],
    url_to_code: Dict[str, str],
    resource_field_types: Dict,
) -> List[Dict[str, Any]]:
    """Returns [{'components': [QueryEntry-with-array_field, ...]}, ...] for the ONE base
    resource `base_resource`, one entry per '|'-separated scope in the composite's own
    `expression` that actually belongs to it.

    Most composites have a single base resource and every '|'-separated scope in `expression`
    is relative to it (e.g. combo-* composites: 'Observation | Observation.component'). A few
    "Multiple Resources" composites (e.g. context-type-quantity) instead have multiple base
    resources with exactly one scope per base, each relative to its OWN resource name (e.g.
    'CapabilityStatement.useContext | CodeSystem.useContext | ...'). `main()` calls this once per
    base resource; only the scope(s) belonging to `base_resource` are built here -- e.g.
    CapabilityStatement's call gets just its own 'CapabilityStatement.useContext' scope, not all
    14 base resources' scopes.
    """
    bases = resource["base"]
    scope_exprs = [s.strip() for s in resource["expression"].split('|')]

    def resource_for_scope(scope_expr: str) -> str:
        if scope_expr in bases:
            return scope_expr
        for candidate_base in bases:
            if scope_expr.startswith(candidate_base + '.'):
                return candidate_base
        raise AssertionError(f"unexpected composite scope {scope_expr!r} for base(s) {bases!r}")

    scope_resources = [resource_for_scope(scope_expr) for scope_expr in scope_exprs]

    own_scope_exprs = [
        scope_expr for scope_expr, scope_resource in zip(scope_exprs, scope_resources)
        if scope_resource == base_resource
    ]
    if not own_scope_exprs:
        raise ValueError(f"composite {resource.get('code')!r} has no scope expression for base resource {base_resource!r}")

    raw_array_paths = [
        None if scope_expr == base_resource else scope_expr[len(base_resource) + 1:]
        for scope_expr in own_scope_exprs
    ]

    # A scope's array path is only a genuine repeating array -- and thus emits arrayField plus a
    # stripped relative field -- if resource_field_types confirms max cardinality '*'. A handful
    # of composites (e.g. MolecularSequence.referenceSeq, max '1') name a singular element
    # instead; treat those as root-equivalent: arrayField None, full dotted field path kept.
    effective_array_paths = [
        raw_array_path if raw_array_path and _is_true_array_path(base_resource, raw_array_path, resource_field_types)
        else None
        for raw_array_path in raw_array_paths
    ]

    # Only genuinely-array scopes should make the root scope exclude their fields.
    array_paths = [p for p in effective_array_paths if p is not None]

    scopes = []
    for array_path in effective_array_paths:
        components = []
        for component in resource["component"]:
            resolved = resolve_composite_component(
                component_expression=component["expression"],
                definition_url=component["definition"],
                outer_resource=base_resource,
                scope_array_path=array_path,
                all_array_paths_for_this_composite=array_paths,
                url_to_code=url_to_code,
                sample_dict=sample_dict,
                resource_field_types=resource_field_types,
            )
            resolved_list = resolved if isinstance(resolved, list) else [resolved]
            effective_array_path = None if component["expression"].startswith('%resource.') else array_path

            def relative(field: str) -> str:
                return field[len(effective_array_path) + 1:] if effective_array_path else field

            if len(resolved_list) == 1:
                r = resolved_list[0]
                components.append({
                    'type_': r.type_,
                    'field': relative(r.field),
                    'fields': None,
                    'array_field': effective_array_path,
                    'target': r.target,  # needed by FilterByReference-typed components
                    'field_type': r.field_type if r.type_ == 'date' else None,  # -> fieldTypesObj, needed by FilterByDateTime's period/timing branch
                    'field_types': None,
                })
            else:
                # 2+ polymorphic .as(Type) alternatives each resolved to exactly one live
                # candidate (e.g. 'value.as(Quantity) | value.as(Range)') -- keep ALL of them,
                # mirroring how pass-1's own multi-field rendering already works for the
                # non-composite equivalent, instead of silently dropping every alternative but
                # one.
                relative_fields = [relative(r.field) for r in resolved_list]
                field_types = {
                    relative(r.field): r.field_type.lower()
                    for r in resolved_list
                    if r.type_ == 'date' and r.field_type
                }
                components.append({
                    'type_': resolved_list[0].type_,  # all alternatives share the referenced SearchParameter's declared type
                    'field': None,
                    'fields': relative_fields,
                    'array_field': effective_array_path,
                    'target': resolved_list[0].target,
                    'field_type': None,
                    'field_types': field_types or None,
                })
        scopes.append({'components': components})
    return scopes


def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")

    with open(data_dir.joinpath("search-parameters.json"), "r+") as file:
        contents = file.read()

    fhir_schema = json.loads(contents)

    entries: List[Dict[str, str]] = fhir_schema["entry"]

    resource_field_types = get_resources_fields_data()

    sample_dict = build_sample_dict(entries, resource_field_types)

    url_to_code = build_url_to_code_map(entries)
    composite_scopes_by_resource_and_code: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        resource = entry["resource"]
        if resource.get("type") != "composite" or resource.get("status") not in ("active", "draft"):
            continue
        for base_resource in resource["base"]:
            composite_scopes_by_resource_and_code.setdefault(base_resource, {})[resource["code"]] = {
                'description': resource.get("description", ""),
                'scopes': build_composite_scopes(resource, base_resource, sample_dict, url_to_code, resource_field_types),
            }

    # generate the file
    field_filter_regex = r"\[([^\]])+\]"

    output_dir: Path = Path("src/searchParameters/")

    # write out the js file
    file_path: Path = output_dir.joinpath("searchParameters.js")
    with open(file_path, "w") as file2:
        file2.write("// noinspection SpellCheckingInspection\n")
        file2.write("// Autogenerated by script: generate_search_parameters.py.  Do not edit.\n")
        file2.write("const {SearchParameterDefinition} = require('./searchParameterTypes');\n")
        file2.write("/**\n")
        file2.write(" * Search Parameters from FHIR spec\n")
        file2.write(" * @type {Object.<string, Object.<string, SearchParameterDefinition>>}\n")
        file2.write(" */\n")
        file2.write("const searchParameterQueries = {\n")
        write_search_parameter_dict(field_filter_regex, file2, sample_dict, composite_scopes_by_resource_and_code, is_python=False)
        file2.write(";\n")
        file2.write("\nmodule.exports = {\n")
        file2.write("\tsearchParameterQueries: searchParameterQueries\n")
        file2.write("};\n")

    # write out the python file
    file_path: Path = data_dir.parent.joinpath("search_parameters.py")
    with open(file_path, "w") as file2:
        file2.write("# Autogenerated by script: generate_search_parameters.py.  Do not edit.\n")
        file2.write("search_parameter_queries = {\n")
        write_search_parameter_dict(field_filter_regex, file2, sample_dict, composite_scopes_by_resource_and_code, is_python=True)
        file2.write("\n")

    parameters_folder: Path = Path("src/middleware/fhir/resources/4_0_0/parameters/")
    if os.path.exists(parameters_folder):
        shutil.rmtree(parameters_folder)
    os.mkdir(parameters_folder)
    # generate parameter files
    write_parameter_files(parameters_folder, sample_dict)

    return 0


def write_parameter_files(parameters_folder: Path, sample_dict):
    resources = ['Account', 'ActivityDefinition', 'AdministrableProductDefinition', 'AdverseEvent',
        'AllergyIntolerance', 'Appointment', 'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary',
        'BiologicallyDerivedProduct', 'BodyStructure', 'Bundle', 'CapabilityStatement', 'CarePlan',
        'CareTeam', 'CatalogEntry', 'ChargeItem', 'ChargeItemDefinition', 'Citation', 'Claim',
        'ClaimResponse', 'ClinicalImpression', 'ClinicalUseDefinition', 'CodeSystem', 'Communication',
        'CommunicationRequest', 'CompartmentDefinition', 'Composition', 'ConceptMap', 'Condition',
        'Consent', 'Contract', 'Coverage', 'CoverageEligibilityRequest', 'CoverageEligibilityResponse',
        'DetectedIssue', 'Device', 'DeviceDefinition', 'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement',
        'DiagnosticReport', 'DocumentManifest', 'DocumentReference', 'Encounter',
        'Endpoint', 'EnrollmentRequest', 'EnrollmentResponse', 'EpisodeOfCare', 'EventDefinition',
        'Evidence', 'EvidenceReport', 'EvidenceVariable', 'ExampleScenario', 'ExplanationOfBenefit',
        'FamilyMemberHistory', 'Flag', 'Goal', 'GraphDefinition', 'Group', 'GuidanceResponse',
        'HealthcareService', 'ImagingStudy', 'Immunization', 'ImmunizationEvaluation',
        'ImmunizationRecommendation', 'ImplementationGuide', 'Ingredient', 'InsurancePlan', 'Invoice',
        'Library', 'Linkage', 'List', 'Location', 'ManufacturedItemDefinition', 'Measure', 'MeasureReport',
        'Media', 'Medication', 'MedicationAdministration', 'MedicationDispense', 'MedicationKnowledge',
        'MedicationRequest', 'MedicationStatement', 'MedicinalProductDefinition', 'MessageDefinition',
        'MessageHeader', 'MolecularSequence', 'NamingSystem', 'NutritionOrder', 'NutritionProduct',
        'Observation', 'ObservationDefinition', 'OperationDefinition', 'OperationOutcome', 'Organization',
        'OrganizationAffiliation', 'PackagedProductDefinition', 'Parameters', 'Patient', 'PaymentNotice',
        'PaymentReconciliation', 'Person', 'PlanDefinition', 'Practitioner', 'PractitionerRole', 'Procedure',
        'Provenance', 'Questionnaire', 'QuestionnaireResponse', 'RegulatedAuthorization', 'RelatedPerson',
        'RequestGroup', 'ResearchDefinition', 'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject',
        'RiskAssessment', 'Schedule', 'SearchParameter', 'ServiceRequest', 'Slot', 'Specimen',
        'SpecimenDefinition', 'StructureDefinition', 'StructureMap', 'Subscription', 'SubscriptionStatus',
        'SubscriptionTopic', 'Substance', 'SubstanceDefinition', 'SupplyDelivery', 'SupplyRequest', 'Task',
        'TerminologyCapabilities', 'TestReport', 'TestScript', 'ValueSet', 'VerificationResult', 'VisionPrescription']

    # generate parameter files
    for resource_name in resources:
        file_name = resource_name.lower() + '.parameters.js'
        file_path = parameters_folder.joinpath(file_name)
        resource_entries_dict = sample_dict[resource_name] if resource_name in sample_dict else None

        with open(file_path, "w") as file:
            file.write("// Autogenerated by script: generate_search_parameters.py.  Do not edit.\n")
            file.write("/**\n")
            file.write(" * @name exports\n")
            file.write(" * @static\n")
            file.write(f" * @summary Arguments for the {resource_name} query\n")
            file.write(" */\n")
            file.write("module.exports = {\n")
            if resource_entries_dict is not None:
                for search_parameter, search_parameter_entries in resource_entries_dict.items():
                    cleaned_description: Optional[str] = search_parameter_entries[0].description.replace('\n', '').replace('\r', '').replace("'", "")
                    file.write("  '" + search_parameter + '\': {\n')
                    file.write(f"    type: '{search_parameter_entries[0].type_}',\n")
                    file.write(f"    fhirtype: '{search_parameter_entries[0].type_}',\n")
                    file.write("    xpath: '" + resource_name + "." + search_parameter_entries[0].field.replace("'", "\\'") + "',\n")
                    file.write(f"    definition: '{search_parameter_entries[0].definition}',\n")
                    file.write(f"    description: '{cleaned_description}',\n")
                    file.write('  },\n')

            file.write("};\n")

    # generate index file
    index_file_path = parameters_folder.joinpath('index.js')
    with open(index_file_path, "w") as index_file:
        for resource_name in resources:
            index_file.write(f"const {resource_name.lower()} = require('./{resource_name.lower()}.parameters.js');\n\n")

        index_file.write("module.exports = {\n")
        for resource_name in resources:
            index_file.write(f"  {resource_name.lower()},\n")
        index_file.write("};\n")


def write_composite_component(file2, comp, is_python):
    none_literal = 'None' if is_python else 'null'
    array_field_literal = f"'{comp['array_field']}'" if comp['array_field'] else none_literal
    extra_fields = ""
    if comp['target']:
        target_list = ", ".join(f"'{t}'" for t in comp['target'])
        extra_fields += f", 'target': [{target_list}]"

    if comp.get('fields'):
        # 2+ polymorphic .as(Type) alternatives each resolved to a live field --
        # mirror the plural fields[]/fieldTypesObj rendering used above for the
        # non-composite, multi-field case, instead of the singular 'field'.
        fields_list = ", ".join(f"'{f}'" for f in comp['fields'])
        if comp['field_types']:
            field_types_str = ", ".join(f"'{k}': '{v}'" for k, v in comp['field_types'].items())
            extra_fields += f", 'fieldTypesObj': {{ {field_types_str} }}"
        if is_python:
            file2.write(f"\t\t\t\t\t{{ 'type': '{comp['type_']}', 'fields': [{fields_list}], 'array_field': {array_field_literal} }},\n")
        else:
            file2.write(f"\t\t\t\t\tnew SearchParameterDefinition({{ 'type': '{comp['type_']}', 'fields': [{fields_list}], 'arrayField': {array_field_literal}{extra_fields} }}),\n")
        return

    if comp['field_type']:
        extra_fields += f", 'fieldTypesObj': {{ '{comp['field']}': '{comp['field_type'].lower()}' }}"
    if is_python:
        file2.write(f"\t\t\t\t\t{{ 'type': '{comp['type_']}', 'field': '{comp['field']}', 'array_field': {array_field_literal} }},\n")
    else:
        file2.write(f"\t\t\t\t\tnew SearchParameterDefinition({{ 'type': '{comp['type_']}', 'field': '{comp['field']}', 'arrayField': {array_field_literal}{extra_fields} }}),\n")


def write_search_parameter_dict(field_filter_regex, file2, sample_dict, composite_scopes_by_resource_and_code, is_python=False):
    resource: str
    resource_entries_dict: Dict[str, List[QueryEntry]]
    for resource, resource_entries_dict in sorted(sample_dict.items()):
        file2.write(f"\t'{resource}': {{\n")
        search_parameter: str
        search_parameter_entries: List[QueryEntry]
        for search_parameter, search_parameter_entries in sorted(resource_entries_dict.items()):
            if is_python:
                file2.write(f"\t\t'{search_parameter}': {{\n")
            else:
                file2.write(f"\t\t'{search_parameter}': new SearchParameterDefinition({{\n")

            if search_parameter_entries[0].description:
                cleaned_description: Optional[str] = search_parameter_entries[0].description.replace('\n', '').replace(
                    '\r', '').replace("'", "")
                file2.write(f"\t\t\t'description': '{cleaned_description}',\n")
                file2.write(f"\t\t\t'type': '{search_parameter_entries[0].type_}',\n")  # we assume all are of same type
            # now figure out the fields
            if len(search_parameter_entries) == 1:  # simple case
                field_filter_match: Match = re.search(field_filter_regex, search_parameter_entries[0].field)
                field_filter: Optional[str] = field_filter_match.group() if field_filter_match else None
                cleaned_field: str = re.sub(field_filter_regex, "", search_parameter_entries[0].field)
                file2.write(f"\t\t\t'field': '{cleaned_field}',\n")
                if field_filter:
                    cleaned_field_filter: str = field_filter.replace("'", "\\'")
                    file2.write(f"\t\t\t'fieldFilter': '{cleaned_field_filter}',\n")
                if search_parameter_entries[0].type_ == 'date' and search_parameter_entries[0].field_type:
                    file2.write(f"\t\t\t'fieldTypesObj': {{ '{cleaned_field}': '{search_parameter_entries[0].field_type.lower()}' }},\n")
            else:
                fields: List[str] = []
                field_filters: List[str] = []
                field_types: dict = {}
                for search_parameter_entry in search_parameter_entries:
                    field_filter_match: Match = re.search(field_filter_regex, search_parameter_entry.field)
                    field_filter: Optional[str] = field_filter_match.group() if field_filter_match else None
                    cleaned_field: str = re.sub(field_filter_regex, "", search_parameter_entry.field)
                    fields.append(cleaned_field)
                    if field_filter:
                        cleaned_field_filter: str = field_filter.replace("'", "\\'")
                        field_filters.append(cleaned_field_filter)
                    if search_parameter_entry.type_ == 'date' and search_parameter_entry.field_type:
                        field_types[cleaned_field] = search_parameter_entry.field_type.lower()
                fields = [f"'{f}'" for f in fields]
                field_filters = [f"'{f}'" for f in field_filters]
                file2.write(f"\t\t\t'fields': [{', '.join(fields)}],\n")
                if len(field_filters) > 0:
                    file2.write(f"\t\t\t'fieldFilters': [{', '.join(field_filters)}],\n")
                if len(field_types) > 0:
                    field_types_str = ", ".join([f"'{k}': '{v}'" for k, v in field_types.items()])
                    file2.write(f"\t\t\t'fieldTypesObj': {{ {field_types_str} }},\n")

            # now write the target.  assume target is same for all search parameters with same name
            if search_parameter_entries[0].target:
                file2.write("\t\t\t'target': [")
                target_list = [f"'{t}'" for t in search_parameter_entries[0].target]
                file2.write(f"{', '.join(target_list)}")
                file2.write("],\n")
            if is_python:
                file2.write("\t\t},\n")
            else:
                file2.write("\t\t}),\n")

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
                    write_composite_component(file2, comp, is_python)
                file2.write("\t\t\t\t] },\n")
            file2.write("\t\t\t],\n")
            if is_python:
                file2.write("\t\t},\n")
            else:
                file2.write("\t\t}),\n")

        file2.write("\t},\n")
    file2.write("}")


if __name__ == "__main__":
    exit(main())
