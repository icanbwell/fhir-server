import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import generate_mcp_tools  # noqa: E402

from jinja2 import Template


def test_format_mcp_description_includes_type():
    param = {"code": "birthdate", "type": "date", "description": "The patient's DOB", "target": []}
    result = generate_mcp_tools.format_mcp_description(param, "Patient")
    # All single quotes (including those in syntax hints) should be escaped
    assert result == (
        "The patient\\'s DOB (date) Prefix the value with a comparator for a range match: "
        "eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. \\'ge2020-01-01\\'). Omit the prefix for an exact match."
    )


def test_format_mcp_description_includes_target_for_references():
    param = {"code": "subject", "type": "reference", "description": "The subject", "target": ["Patient", "Group"]}
    result = generate_mcp_tools.format_mcp_description(param, "Patient")
    # All single quotes should be escaped
    assert result == (
        "The subject (reference: Patient | Group) Format: \\'ResourceType/id\\', or bare \\'id\\' to match "
        "against any of this parameter\\'s allowed target types."
    )


def test_format_mcp_description_includes_token_syntax_hint():
    param = {"code": "identifier", "type": "token", "description": "An identifier", "target": []}
    result = generate_mcp_tools.format_mcp_description(param, "Patient")
    # Check for the escaped version (single quotes are escaped as \')
    assert "Format: \\'system|code\\', or bare \\'code\\' to match any system." in result


def test_format_mcp_description_includes_quantity_syntax_hint():
    param = {"code": "value-quantity", "type": "quantity", "description": "The value", "target": []}
    result = generate_mcp_tools.format_mcp_description(param, "Patient")
    # Check for escaped version
    assert "\\'[comparator]value|system|code\\'" in result


def test_format_mcp_description_includes_composite_syntax_hint():
    param = {"code": "code-value-quantity", "type": "composite", "description": "Code and quantity value parameter pair", "target": []}
    result = generate_mcp_tools.format_mcp_description(param, "Observation")
    assert "$" in result
    assert "composite" in result  # the '(composite)' type suffix


def test_format_mcp_description_falls_back_gracefully_for_unmapped_type():
    param = {"code": "special-param", "type": "special", "description": "Something unusual", "target": []}
    result = generate_mcp_tools.format_mcp_description(param, "Patient")
    assert result == "Something unusual (special)"


def test_format_mcp_description_respects_no_syntax_hint_opt_out():
    # _count/_sort are control parameters SearchManager consumes directly, not ordinary filters --
    # the generic 'number'/'string' TYPE_VALUE_SYNTAX_HINTS entries describe syntax (comparator
    # prefixes, ':exact'/':contains' modifiers) that doesn't apply to them and would silently
    # mislead a caller (see COMMON_PARAMS' comment). no_syntax_hint must suppress that lookup.
    param = {
        "code": "_count", "type": "number", "description": "A plain positive integer.",
        "target": [], "no_syntax_hint": True
    }
    result = generate_mcp_tools.format_mcp_description(param, "Patient")
    assert result == "A plain positive integer. (number)"
    assert "comparator" not in result


def test_common_params_count_and_sort_opt_out_of_syntax_hints():
    common_by_code = {p["code"]: p for p in generate_mcp_tools.COMMON_PARAMS}
    assert common_by_code["_count"]["no_syntax_hint"] is True
    assert common_by_code["_sort"]["no_syntax_hint"] is True


def test_narrow_multiple_resources_description_keeps_only_matching_bullet():
    description = (
        "Multiple Resources: \r\n\r\n"
        "* [AllergyIntolerance](allergyintolerance.html): External ids for this item\r\n"
        "* [Condition](condition.html): A unique identifier of the condition record\r\n"
        "* [Observation](observation.html): The unique id for a particular observation\r\n"
    )
    result = generate_mcp_tools.narrow_multiple_resources_description(description, "Condition")
    assert result == "A unique identifier of the condition record"
    assert "AllergyIntolerance" not in result
    assert "Observation" not in result


def test_narrow_multiple_resources_description_falls_back_when_no_match():
    # Defensive: an HL7 format change or a resource type missing its own bullet must not silently
    # drop the description -- fall back to the untouched original rather than returning empty.
    description = "Multiple Resources: \r\n\r\n* [Observation](observation.html): The value\r\n"
    result = generate_mcp_tools.narrow_multiple_resources_description(description, "Condition")
    assert result == description


def test_narrow_multiple_resources_description_leaves_single_resource_description_untouched():
    description = "A patient identifier"
    result = generate_mcp_tools.narrow_multiple_resources_description(description, "Patient")
    assert result == description


def test_format_mcp_description_narrows_shared_param_to_current_resource_type():
    param = {
        "code": "identifier", "type": "token", "target": [],
        "description": (
            "Multiple Resources: \r\n\r\n"
            "* [Condition](condition.html): A unique identifier of the condition record\r\n"
            "* [Observation](observation.html): The unique id for a particular observation\r\n"
        )
    }
    result = generate_mcp_tools.format_mcp_description(param, "Condition")
    assert result.startswith("A unique identifier of the condition record")
    assert "Observation" not in result
    assert "Multiple Resources" not in result


def test_build_tool_description_mentions_modifiers_and_comma_or():
    result = generate_mcp_tools.build_tool_description("Patient")
    assert "Patient" in result
    # The result is already escaped for use in a single-quoted JS string
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


def test_rendered_tool_js_is_syntactically_valid_and_has_no_unescaped_quotes():
    """Render the template with real Patient data and validate the output.

    This is critical: the template must produce syntactically valid JavaScript
    where all single quotes in description strings are properly escaped.
    """
    import copy

    # Load real search parameters for Patient
    by_resource = generate_mcp_tools.load_search_parameters_by_resource()
    resource_type = "Patient"
    params = generate_mcp_tools.dedupe_by_code(
        generate_mcp_tools.COMMON_PARAMS + by_resource.get(resource_type, [])
    )

    # Copy dicts before mutating to avoid side effects
    params = [copy.copy(param) for param in params]

    # Add mcp_description to each param (as main() does)
    for param in params:
        param["mcp_description"] = generate_mcp_tools.format_mcp_description(param, resource_type)

    # Load and render the template
    template_path = Path(__file__).parent / "template.mcp_tool.jinja2"
    with open(template_path, "r") as f:
        template = Template(f.read(), trim_blocks=True, lstrip_blocks=True)

    rendered = template.render(
        resource_type=resource_type,
        tool_name=f"search_patient",
        tool_description=generate_mcp_tools.build_tool_description(resource_type),
        params=params,
    )

    # Validate: the output should have properly formed describe() calls
    # Count describe() calls - should match number of params
    describe_pattern = r"\.describe\('[^']*(?:\\'[^']*)*'\)"
    describe_calls = re.findall(describe_pattern, rendered)
    assert (
        len(describe_calls) == len(params)
    ), f"Expected {len(params)} describe() calls, got {len(describe_calls)}"
    # Spot-check: all describe calls should be closed properly
    assert "describe()" not in rendered, "Should not have unclosed describe() calls"

    # Validate: the output should look like valid JavaScript (basic checks)
    assert "const tool = {" in rendered, "Should contain const tool = {"
    assert "inputSchema: z.object({" in rendered, "Should contain inputSchema"
    assert ".passthrough()" in rendered, "Should contain passthrough()"
    assert "module.exports = { tool }" in rendered, "Should export tool"

    # Validate: each parameter should be on its own line (not collapsed to one line)
    describe_count = rendered.count(".describe(")
    line_count = rendered.count("\n")
    # We expect at least describe_count lines in the object schema (rough heuristic)
    assert (
        line_count > describe_count // 2
    ), f"Output appears collapsed to one line: {line_count} lines for {describe_count} params"
