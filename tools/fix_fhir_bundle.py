#!/usr/bin/env python3
"""
Prepare a FHIR Bundle (or single resource) for merging to the bwell FHIR server.

Applies every fix required to pass merge validation:
  - Sets meta.source on each resource if missing
  - Removes security tags with null/empty system or code
  - Adds owner security tag if missing or de-duplicates if multiple are present
  - Adds access security tag if missing
  - Adds sourceAssigningAuthority tag if --source-assigning-authority is given
  - Generates a random UUID id for any resource that is missing one
  - Flags ids that contain a pipe character (cannot be auto-fixed)
  - Validates all reference values in the resource tree

Unfixable issues (pipe in id, invalid references, missing required args) are written
to stderr.  The fixed output is still written so you can inspect and correct manually.
Exit code is 0 when all resources are fully fixed, 1 when any unfixable issues remain.

Usage:
    python tools/fix_fhir_bundle.py \\
        --input bundle.json --output fixed.json \\
        --meta-source https://example.org \\
        --owner my-org

    python tools/fix_fhir_bundle.py \\
        --input bundle.json --output fixed.json \\
        --meta-source https://example.org \\
        --owner my-org \\
        --access my-org \\
        --source-assigning-authority my-org

    python tools/fix_fhir_bundle.py \\
        --input bundle.json --output - \\
        --meta-source https://example.org \\
        --owner my-org
"""

import argparse
import json
import re
import sys
import uuid
from pathlib import Path

OWNER_SYSTEM = "https://www.icanbwell.com/owner"
ACCESS_SYSTEM = "https://www.icanbwell.com/access"
SOURCE_ASSIGNING_AUTHORITY_SYSTEM = "https://www.icanbwell.com/sourceAssigningAuthority"

# UUIDv5 namespace used by the server (OID namespace, from src/utils/uid.util.js)
_OID_NAMESPACE = uuid.UUID("6ba7b812-9dad-11d1-80b4-00c04fd430c8")

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
# FHIR relative reference: ResourceType/id
_RELATIVE_REF_RE = re.compile(r"^[A-Z][a-zA-Z]+/\S+$")


def is_uuid(value: str) -> bool:
    return bool(_UUID_RE.match(value))


def deterministic_uuid(resource_id: str, source_assigning_authority: str) -> str:
    """Reproduce the server's UUIDv5 generation for a non-UUID id."""
    return str(uuid.uuid5(_OID_NAMESPACE, f"{resource_id}|{source_assigning_authority}"))


def is_valid_reference(ref: str) -> bool:
    if ref.startswith("#"):
        return len(ref) > 1
    if ref.startswith("http://") or ref.startswith("https://"):
        return True
    return bool(_RELATIVE_REF_RE.match(ref))


def _collect_invalid_references(obj, path: str) -> list[str]:
    issues = []
    if isinstance(obj, dict):
        if "reference" in obj and isinstance(obj["reference"], str):
            ref = obj["reference"]
            if not is_valid_reference(ref):
                issues.append(
                    f"invalid reference at {path}.reference: {ref!r} "
                    "(expected #contained, https://..., or ResourceType/id)"
                )
        for key, value in obj.items():
            issues.extend(_collect_invalid_references(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            issues.extend(_collect_invalid_references(item, f"{path}[{i}]"))
    return issues


def fix_resource(resource: dict, args: argparse.Namespace) -> tuple[dict, list[str], list[str]]:
    """
    Apply all possible fixes to a single resource.
    Returns (fixed_resource, changes, errors) where errors are issues that could not be auto-fixed.
    """
    changes: list[str] = []
    errors: list[str] = []

    if not resource.get("resourceType"):
        errors.append("missing resourceType — cannot determine resource type, fix manually")

    # ── meta.source ──────────────────────────────────────────────────────────
    if "meta" not in resource:
        resource["meta"] = {}

    if not resource["meta"].get("source"):
        if args.meta_source:
            resource["meta"]["source"] = args.meta_source
            changes.append(f"set meta.source = {args.meta_source!r}")
        else:
            errors.append("missing meta.source — provide --meta-source")

    # ── security tags ─────────────────────────────────────────────────────────
    if "security" not in resource["meta"]:
        resource["meta"]["security"] = []

    # Remove tags with null/empty system or code
    before = len(resource["meta"]["security"])
    resource["meta"]["security"] = [
        t for t in resource["meta"]["security"] if t.get("system") and t.get("code")
    ]
    removed = before - len(resource["meta"]["security"])
    if removed:
        changes.append(f"removed {removed} security tag(s) with null/empty system or code")

    def tags_for(system: str) -> list[dict]:
        return [t for t in resource["meta"]["security"] if t.get("system") == system]

    def add_tag(system: str, code: str, label: str) -> None:
        resource["meta"]["security"].append({"system": system, "code": code})
        changes.append(f"added {label} tag (code={code!r})")

    # Owner tag — exactly one required
    owner_tags = tags_for(OWNER_SYSTEM)
    if len(owner_tags) == 0:
        if args.owner:
            add_tag(OWNER_SYSTEM, args.owner, "owner")
        else:
            errors.append("missing owner security tag — provide --owner")
    elif len(owner_tags) > 1:
        kept = owner_tags[0]
        resource["meta"]["security"] = [
            t for t in resource["meta"]["security"] if t.get("system") != OWNER_SYSTEM
        ]
        resource["meta"]["security"].append(kept)
        changes.append(
            f"removed {len(owner_tags) - 1} duplicate owner tag(s), kept code={kept['code']!r}"
        )

    # Access tag
    access_code = args.access or args.owner
    if access_code and not tags_for(ACCESS_SYSTEM):
        add_tag(ACCESS_SYSTEM, access_code, "access")

    # ── id ───────────────────────────────────────────────────────────────────
    if not resource.get("id"):
        new_id = str(uuid.uuid4())
        resource["id"] = new_id
        changes.append(f"generated random id = {new_id!r}")

    resource_id: str = str(resource["id"])

    if "|" in resource_id:
        errors.append(
            f"id contains a pipe character '|': {resource_id!r} — "
            "remove the pipe and set --source-assigning-authority to the portion after it"
        )

    # Non-UUID id requires owner or sourceAssigningAuthority tag
    if not is_uuid(resource_id) and "|" not in resource_id:
        has_owner_now = bool(tags_for(OWNER_SYSTEM))
        has_saa = bool(tags_for(SOURCE_ASSIGNING_AUTHORITY_SYSTEM))
        if not has_owner_now and not has_saa:
            saa = args.source_assigning_authority or args.owner
            if saa:
                add_tag(SOURCE_ASSIGNING_AUTHORITY_SYSTEM, saa, "sourceAssigningAuthority")
            else:
                errors.append(
                    "non-UUID id requires an owner or sourceAssigningAuthority security tag — "
                    "provide --owner or --source-assigning-authority"
                )

    # Add sourceAssigningAuthority if explicitly requested and not already present
    if args.source_assigning_authority and not tags_for(SOURCE_ASSIGNING_AUTHORITY_SYSTEM):
        add_tag(
            SOURCE_ASSIGNING_AUTHORITY_SYSTEM,
            args.source_assigning_authority,
            "sourceAssigningAuthority",
        )

    # ── references ───────────────────────────────────────────────────────────
    resource_label = f"{resource.get('resourceType', '?')}/{resource.get('id', '?')}"
    for issue in _collect_invalid_references(resource, resource_label):
        errors.append(issue)

    return resource, changes, errors


def extract_resources(payload: dict) -> list[dict]:
    resource_type = payload.get("resourceType")
    if resource_type == "Bundle":
        return [e["resource"] for e in payload.get("entry", []) if "resource" in e]
    if resource_type == "Parameters":
        return [p["resource"] for p in payload.get("parameter", []) if "resource" in p]
    return [payload]


def rebuild_payload(original: dict, fixed_resources: list[dict]) -> dict:
    resource_type = original.get("resourceType")
    resource_iter = iter(fixed_resources)

    if resource_type == "Bundle":
        result = {**original}
        result["entry"] = [
            {**e, "resource": next(resource_iter)} if "resource" in e else e
            for e in original.get("entry", [])
        ]
        return result

    if resource_type == "Parameters":
        result = {**original}
        result["parameter"] = [
            {**p, "resource": next(resource_iter)} if "resource" in p else p
            for p in original.get("parameter", [])
        ]
        return result

    return fixed_resources[0]


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", "-i",
        metavar="PATH",
        required=True,
        help="Path to a FHIR Bundle, Parameters, or single resource JSON file.",
    )
    parser.add_argument(
        "--output", "-O",
        metavar="PATH",
        required=True,
        help="Path to write the fixed JSON file. Use - for stdout.",
    )
    parser.add_argument(
        "--meta-source", "-s",
        metavar="URL",
        help="Value to set on meta.source for each resource that is missing it.",
    )
    parser.add_argument(
        "--owner", "-o",
        metavar="CODE",
        help=(
            "Code for the owner security tag "
            f"(system: {OWNER_SYSTEM}). "
            "Also used as the default for --access and --source-assigning-authority."
        ),
    )
    parser.add_argument(
        "--access", "-c",
        metavar="CODE",
        help=(
            f"Code for the access security tag (system: {ACCESS_SYSTEM}). "
            "Defaults to --owner if not specified."
        ),
    )
    parser.add_argument(
        "--source-assigning-authority", "-a",
        metavar="CODE",
        help=(
            f"Code for the sourceAssigningAuthority tag (system: {SOURCE_ASSIGNING_AUTHORITY_SYSTEM}). "
            "Added to every resource. For non-UUID ids, also satisfies the id-format requirement "
            "when --owner is not provided. Defaults to --owner when needed."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report changes and errors without writing any output.",
    )
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"ERROR: file not found: {args.input}", file=sys.stderr)
        return 1
    raw = path.read_text(encoding="utf-8")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON — {exc}", file=sys.stderr)
        return 1

    resources = extract_resources(payload)
    if not resources:
        print("ERROR: no resources found in input", file=sys.stderr)
        return 1

    fixed_resources: list[dict] = []
    total_errors = 0
    total_changes = 0

    for i, resource in enumerate(resources, start=1):
        label = f"{resource.get('resourceType', 'Unknown')}/{resource.get('id', '<no id>')}"
        fixed, changes, errors = fix_resource(resource, args)
        fixed_resources.append(fixed)

        if changes or errors:
            print(f"\n[{i}] {label}", file=sys.stderr)
        for change in changes:
            print(f"  + {change}", file=sys.stderr)
            total_changes += 1
        for error in errors:
            print(f"  ! {error}", file=sys.stderr)
            total_errors += 1

    print(
        f"\nSummary: {len(resources)} resource(s), "
        f"{total_changes} fix(es) applied, "
        f"{total_errors} unfixable issue(s).",
        file=sys.stderr,
    )

    if args.dry_run:
        print("Dry run — no output written.", file=sys.stderr)
        return 1 if total_errors else 0

    result = rebuild_payload(payload, fixed_resources)
    output_json = json.dumps(result, indent=2)

    if args.output == "-":
        print(output_json)
    else:
        Path(args.output).write_text(output_json, encoding="utf-8")
        print(f"Wrote fixed output to {args.output}", file=sys.stderr)

    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(main())
