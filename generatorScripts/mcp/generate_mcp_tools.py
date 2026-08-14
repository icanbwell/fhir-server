"""Generates one MCP search tool definition per commonly-used FHIR resource, from the same
HL7 search-parameters.json bundle generate_search_parameters.py reads. Generated files are pure
data (name/description/resourceType/inputSchema) -- no business logic lives in generated code.
"""

import copy
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

from jinja2 import Template

SCRIPT_DIR = Path(__file__).parent
SEARCH_PARAMETERS_JSON = SCRIPT_DIR.parent.joinpath("searchParameters", "search-parameters.json")
COMMONLY_USED_RESOURCES_JSON = SCRIPT_DIR.joinpath("commonly_used_resources.json")
TEMPLATE_PATH = SCRIPT_DIR.joinpath("template.mcp_tool.jinja2")
OUTPUT_DIR = SCRIPT_DIR.parent.parent.joinpath("src", "mcp", "tools")

# Every resource supports these generically via R4ArgsParser/SearchManager, regardless of whether
# search-parameters.json lists them per-resource.
#
# _count/_sort are marked no_syntax_hint: unlike ordinary search filters, they're control
# parameters SearchManager.handleCountOption/handleSortQuery consume directly rather than routing
# through the generic type-based query builders -- so the comparator-prefix ('ge5') and
# ':exact'/':contains' modifier syntax that TYPE_VALUE_SYNTAX_HINTS's 'number'/'string' entries
# describe for ordinary parameters does not apply to them (handleCountOption does a plain
# Number(parsedArgs._count), so 'ge5' silently becomes NaN; handleSortQuery reads '_sort' as a
# literal field-name list, so a ':exact'-modified key is never recognized). Their own description
# text below is already accurate on its own -- the bug this avoids is format_mcp_description()
# appending a *wrong* hint on top of an already-correct description.
COMMON_PARAMS: List[Dict[str, Any]] = [
    {"code": "_id", "type": "token", "description": "The logical resource id.", "target": []},
    {"code": "_lastUpdated", "type": "date", "description": "When the resource was last updated.", "target": []},
    {"code": "_count", "type": "number", "description": "Number of results to return per page. A plain positive integer -- comparator prefixes are not supported.", "target": [], "no_syntax_hint": True},
    {"code": "_sort", "type": "string", "description": "Comma-separated fields to sort by; prefix a field with '-' for descending. Literal field names only -- ':exact'/':contains' modifiers are not supported.", "target": [], "no_syntax_hint": True},
]

# Subscription/SubscriptionStatus narrow patient-scope search by a b.well-specific `extension`
# token filter -- patientFilterManager.personFilterWithQueryMapping
# (src/fhir/patientFilterManager.js) maps both to
# 'extension=https://icanbwell.com/codes/client_person_id|{person}' -- rather than a standard HL7
# SearchParameter, so it never appears in search-parameters.json and would otherwise be
# undocumented on these two tools (still functional via inputSchema's .passthrough(), just not
# discoverable). SubscriptionTopic needs no equivalent entry: its patient-scope narrowing uses the
# standard `identifier` token param, already present in search-parameters.json.
#
# These entries hand-duplicate src/searchParameters/searchParametersManager.js's
# customSearchParameterQueries (the actual runtime source of truth r4ArgsParser.js reads via
# getPropertyObject) -- nothing keeps the two in sync, so a new entry added there needs a matching
# entry added here by hand. TODO(follow-up PR): have this generator read
# customSearchParameterQueries directly (e.g. via a shared JSON file) instead of re-declaring it.
EXTENSION_SEARCH_PARAM_OVERRIDES: Dict[str, List[Dict[str, Any]]] = {
    "Subscription": [{
        "code": "extension",
        "type": "token",
        "description": (
            "Search by a resource extension value, e.g. the b.well connection-identity extension "
            "'https://icanbwell.com/codes/client_person_id'."
        ),
        "target": [],
    }],
    "SubscriptionStatus": [
        {
            "code": "extension",
            "type": "token",
            "description": (
                "Search by a resource extension value, e.g. the b.well connection-identity "
                "extension 'https://icanbwell.com/codes/client_person_id'."
            ),
            "target": [],
        },
        {
            "code": "subscription",
            "type": "reference",
            "description": "Subscription that this status is for.",
            "target": ["Subscription"],
        },
    ],
}

# How to actually *write* a filter value for each FHIR SearchParameter.type, verified against this
# repo's own filter implementations (src/operations/query/filters/*.js + src/utils/querybuilder.util.js),
# not just the FHIR spec text -- a server's exact accepted syntax can differ in the details (e.g.
# this repo's `canonical` filter does a plain exact match; it does not parse a spec-allowed
# '|version' suffix, so documenting that suffix here would be wrong). Keyed by SearchParameter.type,
# so this is written once and applied to every resource/parameter -- exactly the kind of thing that
# belongs in the generator rather than hand-copied into each tool's description.
## Sources verified for each entry below (not shipped in the description text itself):
## date/dateTime/instant/period -> src/operations/query/filters/dateTime.js + querybuilder.util.js:dateQueryBuilder
## number                       -> src/operations/query/filters/number.js:numberQueryBuilder
## quantity                     -> src/operations/query/filters/quantity.js:quantityQueryBuilder
## token                        -> src/operations/query/filters/token.js:tokenQueryBuilder
## reference                    -> src/operations/query/filters/reference.js + utils/referenceParser.js
## string                       -> src/operations/query/filters/string.js
## uri                          -> src/operations/query/filters/uri.js
## canonical                    -> src/operations/query/filters/canonical.js (plain exact match --
##                                  this server does NOT parse a '|version' suffix, unlike the FHIR
##                                  spec's general allowance for one; do not claim it does)
TYPE_VALUE_SYNTAX_HINTS: Dict[str, str] = {
    "date": "Prefix the value with a comparator for a range match: eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge2020-01-01'). Omit the prefix for an exact match.",
    "dateTime": "Prefix the value with a comparator for a range match: eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge2020-01-01'). Omit the prefix for an exact match.",
    "instant": "Prefix the value with a comparator for a range match: eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge2020-01-01T00:00:00Z'). Omit the prefix for an exact match.",
    "period": "Prefix the value with a comparator for a range match: eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge2020-01-01'). Omit the prefix for an exact match.",
    "number": "Prefix the value with a comparator for a range match: eq, ne, gt, lt, ge, le, sa, eb, ap (e.g. 'ge5'). Omit the prefix for an exact match.",
    "quantity": "Format: '[comparator]value|system|code', e.g. 'ge5.4|http://unitsofmeasure.org|mg'. system and code may be omitted.",
    "token": "Format: 'system|code', or bare 'code' to match any system.",
    "reference": "Format: 'ResourceType/id', or bare 'id' to match against any of this parameter's allowed target types.",
    "string": "Case-insensitive; matches values starting with the given text by default. Append ':exact' to the parameter name for an exact match, or ':contains' for a substring match anywhere in the value.",
    "uri": "Exact match by default. Append ':above' or ':below' to the parameter name for hierarchical URI matching.",
    "canonical": "Exact match on the canonical URL value.",
    "email": "Bare email value, e.g. 'foo@example.com'.",
    "phone": "Bare phone value.",
}


def load_search_parameters_by_resource() -> Dict[str, List[Dict[str, Any]]]:
    with open(SEARCH_PARAMETERS_JSON, "r") as f:
        fhir_schema = json.load(f)

    by_resource: Dict[str, List[Dict[str, Any]]] = {}
    for entry in fhir_schema["entry"]:
        resource: Dict[str, Any] = entry["resource"]
        if resource.get("status") not in ("active", "draft"):
            continue
        param = {
            "code": resource["code"],
            "type": resource["type"],
            "description": resource.get("description", ""),
            "target": resource.get("target", []),
        }
        for base_resource_type in resource.get("base", []):
            by_resource.setdefault(base_resource_type, []).append(param)
    return by_resource


def load_commonly_used_resources() -> List[str]:
    with open(COMMONLY_USED_RESOURCES_JSON, "r") as f:
        return json.load(f)["resourceTypes"]


def to_snake_case(resource_type: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", resource_type).lower()


MULTIPLE_RESOURCES_BULLET_RE = re.compile(r"\*\s*\[([A-Za-z]+)\]\([^)]*\):\s*(.*)")


def narrow_multiple_resources_description(description: str, resource_type: str) -> str:
    # A search parameter shared across resource types (identifier, code, patient, date, focus,
    # etc.) carries HL7's raw description verbatim: "Multiple Resources: \r\n\r\n* [TypeA](url):
    # descA\r\n* [TypeB](url): descB\r\n...", one bullet per resource type it applies to. Copying
    # that whole block into e.g. condition.tool.js's 'identifier' field means every MCP client
    # reads ~29 other resource types' descriptions to find the one bullet (Condition's) that's
    # actually relevant to the tool it's calling -- pure token bloat with no benefit, since the
    # tool's own resourceType is already fixed. Narrow to just the current resource type's own
    # bullet; fall back to the untouched description if the format doesn't match (e.g. a
    # single-resource description, or an HL7 format change) rather than silently dropping content.
    if not description.startswith("Multiple Resources:"):
        return description
    for line in description.split("\r\n"):
        match = MULTIPLE_RESOURCES_BULLET_RE.match(line.strip())
        if match and match.group(1) == resource_type:
            return match.group(2)
    return description


def format_mcp_description(param: Dict[str, Any], resource_type: str) -> str:
    raw_description = narrow_multiple_resources_description(
        param.get("description") or param["code"], resource_type
    )
    # Normalize all line endings (CRLF and LF) to spaces
    text = raw_description.replace("\r\n", " ").replace("\r", " ").replace("\n", " ").strip()
    suffix = f" ({param['type']}"
    if param.get("target"):
        suffix += f": {' | '.join(param['target'])}"
    suffix += ")"
    syntax_hint = None if param.get("no_syntax_hint") else TYPE_VALUE_SYNTAX_HINTS.get(param["type"])
    if syntax_hint:
        suffix += f" {syntax_hint}"
    # Escape the entire assembled description (both text and suffix) for use in a single-quoted JS string
    full_description = (text + suffix).replace("\\", "\\\\").replace("'", "\\'").replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    return full_description


def dedupe_by_code(params: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    deduped = []
    for param in params:
        if param["code"] in seen:
            continue
        seen.add(param["code"])
        deduped.append(param)
    return deduped


def render_index_js(resource_types: List[str], file_names: List[str]) -> str:
    lines = ["// Autogenerated by generatorScripts/mcp/generate_mcp_tools.py. Do not edit.\n\n"]
    for file_name in file_names:
        lines.append(f"const {{ tool: {file_name}Tool }} = require('./{file_name}.tool');\n")
    lines.append("\nmodule.exports = {\n    mcpToolsByResourceType: {\n")
    for resource_type, file_name in zip(resource_types, file_names):
        lines.append(f"        {resource_type}: {file_name}Tool,\n")
    lines.append("    }\n};\n")
    return "".join(lines)


# Modifiers accepted on ANY search parameter regardless of type, verified against
# src/operations/query/r4.js's modifier dispatch (checked before the type-specific filter switch,
# so it is not gated per-type at the code level even though only some are spec-meaningful for a
# given type -- e.g. ':contains' is meaningful for 'string' but not 'date'). Comma-separated OR
# values are likewise universal, verified against src/operations/query/r4ArgsParser.js:131 and
# src/operations/query/queryParameterValue.js:52 (both split on ',' before any type-specific
# filter runs). This sentence is generated once and reused for every tool, rather than repeated
# per-resource, since it's identical for all of them.
GENERIC_SEARCH_CONVENTIONS = (
    "Comma-separate multiple values for the same parameter to OR them (e.g. 'active,inactive'). "
    "Every parameter also accepts these FHIR search modifiers by appending ':modifier' to the "
    "parameter name: :missing, :not, :contains, :exact, :above, :below, :text, :of-type (not every "
    "modifier is meaningful for every parameter -- see each parameter's own description for its "
    "expected value syntax)."
)


def build_tool_description(resource_type: str) -> str:
    # Already escaped for safe insertion into single-quoted JS string
    description = (
        f"Search FHIR {resource_type} resources using its supported search parameters. "
        f"{GENERIC_SEARCH_CONVENTIONS}"
    )
    return description.replace("\\", "\\\\").replace("'", "\\'").replace("\r\n", " ").replace("\r", " ").replace("\n", " ")


def render_type_value_syntax_hints_js() -> str:
    lines = ["// Autogenerated by generatorScripts/mcp/generate_mcp_tools.py. Do not edit.\n\n"]
    lines.append("module.exports = {\n    TYPE_VALUE_SYNTAX_HINTS: {\n")
    for type_name, hint in TYPE_VALUE_SYNTAX_HINTS.items():
        escaped_hint = hint.replace("\\", "\\\\").replace("'", "\\'")
        lines.append(f"        '{type_name}': '{escaped_hint}',\n")
    lines.append("    }\n};\n")
    return "".join(lines)


def main() -> int:
    search_parameters_by_resource = load_search_parameters_by_resource()
    commonly_used_resources = load_commonly_used_resources()

    with open(TEMPLATE_PATH, "r") as f:
        template = Template(f.read(), trim_blocks=True, lstrip_blocks=True)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    file_names: List[str] = []

    for resource_type in commonly_used_resources:
        params = dedupe_by_code(
            COMMON_PARAMS
            + EXTENSION_SEARCH_PARAM_OVERRIDES.get(resource_type, [])
            + search_parameters_by_resource.get(resource_type, [])
        )
        # Copy dicts before mutating to avoid modifying COMMON_PARAMS across iterations
        params = [copy.copy(param) for param in params]
        for param in params:
            param["mcp_description"] = format_mcp_description(param, resource_type)

        file_name = to_snake_case(resource_type)
        rendered = template.render(
            resource_type=resource_type,
            tool_name=f"search_{file_name}",
            tool_description=build_tool_description(resource_type),
            params=params,
        )
        file_path = OUTPUT_DIR.joinpath(f"{file_name}.tool.js")
        with open(file_path, "w") as out_file:
            out_file.write(rendered)
        file_names.append(file_name)
        print(f"Wrote {file_path}")

    index_path = OUTPUT_DIR.joinpath("index.js")
    with open(index_path, "w") as out_file:
        out_file.write(render_index_js(commonly_used_resources, file_names))
    print(f"Wrote {index_path}")

    # genericFhirSearchTool.js (hand-maintained, not generated) builds its own filter-value-syntax
    # cheat sheet from this module rather than hand-copying TYPE_VALUE_SYNTAX_HINTS' content into a
    # separate prose string, so the two can no longer silently drift apart.
    hints_path = OUTPUT_DIR.parent.joinpath("typeValueSyntaxHints.js")
    with open(hints_path, "w") as out_file:
        out_file.write(render_type_value_syntax_hints_js())
    print(f"Wrote {hints_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
