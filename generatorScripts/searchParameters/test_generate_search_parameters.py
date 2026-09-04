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
