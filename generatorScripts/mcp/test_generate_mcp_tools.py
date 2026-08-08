import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import generate_mcp_tools  # noqa: E402


def test_format_mcp_description_includes_type():
    param = {"code": "birthdate", "type": "date", "description": "The patient's DOB", "target": []}
    result = generate_mcp_tools.format_mcp_description(param)
    assert result == (
        "The patient\\'s DOB (date) Prefix the value with a comparator for a range match: "
        "eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge2020-01-01'). Omit the prefix for an exact match."
    )


def test_format_mcp_description_includes_target_for_references():
    param = {"code": "subject", "type": "reference", "description": "The subject", "target": ["Patient", "Group"]}
    result = generate_mcp_tools.format_mcp_description(param)
    assert result == (
        "The subject (reference: Patient | Group) Format: 'ResourceType/id', or bare 'id' to match "
        "against any of this parameter's allowed target types."
    )


def test_format_mcp_description_includes_token_syntax_hint():
    param = {"code": "identifier", "type": "token", "description": "An identifier", "target": []}
    result = generate_mcp_tools.format_mcp_description(param)
    assert "Format: 'system|code', or bare 'code' to match any system." in result


def test_format_mcp_description_includes_quantity_syntax_hint():
    param = {"code": "value-quantity", "type": "quantity", "description": "The value", "target": []}
    result = generate_mcp_tools.format_mcp_description(param)
    assert "'[comparator]value|system|code'" in result


def test_format_mcp_description_falls_back_gracefully_for_unmapped_type():
    param = {"code": "special-param", "type": "special", "description": "Something unusual", "target": []}
    result = generate_mcp_tools.format_mcp_description(param)
    assert result == "Something unusual (special)"


def test_build_tool_description_mentions_modifiers_and_comma_or():
    result = generate_mcp_tools.build_tool_description("Patient")
    assert "Patient" in result
    assert ":contains" in result
    assert "Comma-separate" in result


def test_dedupe_by_code_keeps_first_occurrence():
    params = [
        {"code": "_id", "type": "token", "description": "common", "target": []},
        {"code": "_id", "type": "token", "description": "spec duplicate", "target": []},
    ]
    result = generate_mcp_tools.dedupe_by_code(params)
    assert len(result) == 1
    assert result[0]["description"] == "common"


def test_to_snake_case_converts_pascal_case():
    assert generate_mcp_tools.to_snake_case("DiagnosticReport") == "diagnostic_report"
    assert generate_mcp_tools.to_snake_case("Patient") == "patient"


def test_load_commonly_used_resources_reads_curated_list():
    resources = generate_mcp_tools.load_commonly_used_resources()
    assert "Patient" in resources
    assert isinstance(resources, list)


def test_load_search_parameters_by_resource_has_patient_name_param():
    by_resource = generate_mcp_tools.load_search_parameters_by_resource()
    codes = [p["code"] for p in by_resource["Patient"]]
    assert "name" in codes
