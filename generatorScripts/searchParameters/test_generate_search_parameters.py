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
    return sample_dict, gsp.build_url_to_code_map(entries), resource_field_types


def _composite_resource(code):
    for entry in _load_entries():
        resource = entry["resource"]
        if resource.get("type") == "composite" and resource["code"] == code:
            return resource
    raise AssertionError(f"no composite entry with code {code!r}")


def _composite_resource_by_id(resource_id):
    for entry in _load_entries():
        resource = entry["resource"]
        if resource.get("type") == "composite" and resource["id"] == resource_id:
            return resource
    raise AssertionError(f"no composite entry with id {resource_id!r}")


def test_root_only_composite_code_value_quantity():
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("code-value-quantity")
    scopes = gsp.build_composite_scopes(resource, "Observation", sample_dict, url_to_code, resource_field_types)
    assert len(scopes) == 1
    components = scopes[0]['components']
    assert components[0]['field'] == 'code'
    assert components[0]['array_field'] is None
    assert components[1]['field'] == 'valueQuantity'
    assert components[1]['array_field'] is None
    assert components[1]['type_'] == 'quantity'


def test_array_only_composite_component_code_value_quantity():
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("component-code-value-quantity")
    scopes = gsp.build_composite_scopes(resource, "Observation", sample_dict, url_to_code, resource_field_types)
    assert len(scopes) == 1
    components = scopes[0]['components']
    assert components[0]['field'] == 'code'
    assert components[0]['array_field'] == 'component'
    assert components[1]['field'] == 'valueQuantity'
    assert components[1]['array_field'] == 'component'


def test_or_of_scopes_composite_combo_code_value_quantity():
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("combo-code-value-quantity")
    scopes = gsp.build_composite_scopes(resource, "Observation", sample_dict, url_to_code, resource_field_types)
    assert len(scopes) == 2
    root_components, array_components = scopes[0]['components'], scopes[1]['components']
    assert root_components[0]['field'] == 'code' and root_components[0]['array_field'] is None
    assert root_components[1]['field'] == 'valueQuantity' and root_components[1]['array_field'] is None
    assert array_components[0]['field'] == 'code' and array_components[0]['array_field'] == 'component'
    assert array_components[1]['field'] == 'valueQuantity' and array_components[1]['array_field'] == 'component'


def test_genomics_composite_with_resource_override():
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("chromosome-variant-coordinate")
    scopes = gsp.build_composite_scopes(resource, "MolecularSequence", sample_dict, url_to_code, resource_field_types)
    assert len(scopes) == 1
    components = scopes[0]['components']
    assert components[0]['field'] == 'referenceSeq.chromosome'
    assert components[0]['array_field'] is None  # %resource. override always resolves to root
    assert components[1]['field'] == 'start' and components[1]['array_field'] == 'variant'
    assert components[2]['field'] == 'end' and components[2]['array_field'] == 'variant'


def test_unresolvable_definition_url_raises():
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("code-value-quantity")
    import copy
    broken = copy.deepcopy(resource)
    broken["component"][0]["definition"] = "http://hl7.org/fhir/SearchParameter/does-not-exist"
    try:
        gsp.build_composite_scopes(broken, "Observation", sample_dict, url_to_code, resource_field_types)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_multi_base_composite_gets_only_its_own_scope():
    # context-type-quantity has 14 base resources, one scope expression per base
    # (e.g. 'CapabilityStatement.useContext | CodeSystem.useContext | ...'). Each base resource's
    # generated entry must have exactly its OWN scope, not all 14.
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    # Several distinct entries share the code 'context-type-quantity' (one per base resource,
    # e.g. id 'ActivityDefinition-context-type-quantity' with base=['ActivityDefinition']);
    # 'conformance-context-type-quantity' is the "Multiple Resources" one with all 14 bases.
    resource = _composite_resource_by_id("conformance-context-type-quantity")
    assert len(resource["base"]) > 1

    capability_scopes = gsp.build_composite_scopes(resource, "CapabilityStatement", sample_dict, url_to_code, resource_field_types)
    assert len(capability_scopes) == 1
    components = capability_scopes[0]['components']
    assert components[0]['array_field'] == 'useContext'
    assert components[1]['array_field'] == 'useContext'

    codesystem_scopes = gsp.build_composite_scopes(resource, "CodeSystem", sample_dict, url_to_code, resource_field_types)
    assert len(codesystem_scopes) == 1


def test_multi_alternative_cast_keeps_all_live_fields():
    # Observation-value-date's composite component expression is
    # '(value as dateTime) | (value as Period)'; BOTH alternatives have a live candidate field
    # (valueDateTime and valuePeriod), so the generated component must keep both as a plural
    # fields[]/fieldTypesObj, not silently drop one.
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("code-value-date")
    scopes = gsp.build_composite_scopes(resource, "Observation", sample_dict, url_to_code, resource_field_types)
    assert len(scopes) == 1
    value_component = scopes[0]['components'][1]
    assert value_component['field'] is None
    assert sorted(value_component['fields']) == ['valueDateTime', 'valuePeriod']
    assert value_component['field_types'] == {'valueDateTime': 'datetime', 'valuePeriod': 'period'}


def test_referenceseq_scope_is_root_equivalent_not_array():
    # MolecularSequence.referenceSeq is max cardinality '1' (a singular BackboneElement, not a
    # repeating array), even though chromosome-window-coordinate's expression scopes its
    # components under it ('MolecularSequence.referenceSeq'). It must be treated as
    # root-equivalent: arrayField None, full dotted field path kept (not stripped).
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    resource = _composite_resource("chromosome-window-coordinate")
    scopes = gsp.build_composite_scopes(resource, "MolecularSequence", sample_dict, url_to_code, resource_field_types)
    assert len(scopes) == 1
    components = scopes[0]['components']
    for comp in components:
        assert comp['array_field'] is None
    assert components[0]['field'] == 'referenceSeq.chromosome'
    assert components[1]['field'] == 'referenceSeq.windowStart'
    assert components[2]['field'] == 'referenceSeq.windowEnd'


def test_all_composite_entries_resolve_to_valid_scopes():
    sample_dict, url_to_code, resource_field_types = _build_sample_dict_and_url_map()
    entries = _load_entries()
    composite_entries = [e["resource"] for e in entries if e["resource"].get("type") == "composite"]
    assert len(composite_entries) == 46, f"expected 46 composite entries, found {len(composite_entries)}"
    failures = []
    for resource in composite_entries:
        for base_resource in resource["base"]:
            try:
                scopes = gsp.build_composite_scopes(resource, base_resource, sample_dict, url_to_code, resource_field_types)
            except ValueError as e:
                failures.append(f"{resource['code']}/{base_resource}: {e}")
                continue
            for scope in scopes:
                for comp in scope['components']:
                    has_field = comp['field'] or comp.get('fields')
                    if not has_field or not comp['type_']:
                        failures.append(f"{resource['code']}/{base_resource}: component missing field/type: {comp}")
    assert not failures, "unresolved composite components:\n" + "\n".join(failures)
