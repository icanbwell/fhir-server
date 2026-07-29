---
name: add-schema-field
description: Add a new field to the OpenSearch schema and expose it in GraphQL responses for searchProviders and/or searchHealthResources queries
version: 1.0.0
author: Josh Nelson
created: 2026-05-06
updated: 2026-05-06
tags: [opensearch, graphql, schema, field, endpoint, provider-search]
---

# Add Schema Field

## Purpose

Guide an agent through the full end-to-end process of adding a new field to the provider search system. This includes the OpenSearch document schema, GraphQL type definitions, resolver transformations, and test updates.

## Trigger Conditions

- User asks to "add a field" or "add a new field" to the schema
- User asks to expose a new data attribute in search results
- User mentions adding a field to OpenSearch and/or GraphQL
- User wants to add a subfield to an existing nested type (e.g., endpoint, location, organization)

## Instructions

### Step 1: Gather Requirements

Before writing code, determine:

1. **Field name**: Must be camelCase to match existing conventions (e.g., `connectionStatus`, `connectionType`)
2. **Parent location**: Is this a top-level field on the document or a subfield of a nested type?
   - Nested types are defined as `InnerDoc` classes in `providersearch/schema/base_document.py`
   - Common nested types: `Endpoint`, `Location`, `Organization`, `Coding`, `Identifier`
3. **Data type**: Scalar (`Keyword`, `Text`, `Boolean`, `Integer`, `Float`) or complex (`Nested(SomeInnerDoc)`)
4. **GraphQL type**: `String`, `Boolean`, `Int`, `Float`, a custom enum, or a complex type
5. **Enum values** (if applicable): What are the allowed values? Are they stored lowercase in OpenSearch and returned uppercase in GraphQL?
6. **Visibility**: Public (no tag) or private (`@tag(name: "private")`)
7. **Which indices**: Does this field appear on practice documents, practitioner documents, or both?
8. **Transformation needed**: Does the value need conversion between OpenSearch and GraphQL? (e.g., case transformation for enums)

### Step 2: Update the OpenSearch Schema

**File**: `providersearch/schema/base_document.py`

Add the field to the appropriate `InnerDoc` class or document class.

```python
# For a simple keyword field on Endpoint:
class Endpoint(InnerDoc):
    connectionStatus = Keyword()

# For a nested complex field:
class Endpoint(InnerDoc):
    newField = Nested(SomeCoding)
```

**Type mapping reference**:
| Python/OpenSearch | GraphQL |
|---|---|
| `Keyword()` | `String` or custom enum |
| `Text()` | `String` |
| `Boolean()` | `Boolean` |
| `Integer()` | `Int` |
| `Float()` | `Float` |
| `Nested(Coding)` | `ProviderCoding` or `Coding` |
| `Nested(Identifier)` | `[ProviderIdentifier]` or `[Identifier]` |

### Step 3: Update GraphQL Schemas

There are **three** GraphQL schema files that must be updated. All `.graphql` files within the same directory are loaded together by Ariadne, so shared type definitions (like enums) must only be defined once per directory.

#### 3a. SDK Schema
**File**: `providersearch/graphql/sdk/schema_sdk.graphql`

- Add the field to the appropriate type (e.g., `EndpointType`, `SearchProvidersResult`)
- If adding an enum, define it near related enums
- Apply `@tag(name: "private")` if the field should be restricted

#### 3b. Classic Updated Schema
**File**: `providersearch/graphql/classic/schema_classic_updated.graphql`

- Same field addition as SDK, but without `@tag` annotations
- Define new enums here (they will be shared with `schema_classic.graphql` since both are loaded together)

#### 3c. Classic Schema
**File**: `providersearch/graphql/classic/schema_classic.graphql`

- Add the field to the corresponding type (note: type names may differ, e.g., `Endpoint` vs `EndpointType`)
- Do NOT define enums here if already defined in `schema_classic_updated.graphql` — both files are loaded together and duplicate definitions cause errors

**Important**: The classic directory loads both `.graphql` files together. Any enum or type defined in one file is visible in the other. Never duplicate type/enum definitions across files in the same directory.

### Step 4: Update Resolvers (if transformation needed)

**File**: `providersearch/utilities/update_resolvers/query_resolvers.py`

If the field requires transformation (e.g., lowercase to uppercase for enums):

```python
def _endpoint_type_resolver(self) -> ObjectType:
    endpoint_type_resolver = ObjectType("EndpointType")
    endpoint_type_resolver.set_field("status", lambda obj, info: to_upper("status", obj))
    endpoint_type_resolver.set_field("connectionStatus", lambda obj, info: to_upper("connectionStatus", obj))
    return endpoint_type_resolver
```

The `to_upper` helper is defined in `providersearch/utilities/update_resolvers/shared/shared_resolvers.py` and handles `None` gracefully.

If no transformation is needed (field value passes through as-is), no resolver change is required — Ariadne resolves fields by name automatically.

### Step 5: Update Tests

Tests follow this structure:
```
tests/end_to_end/camel_case_schema/test_<name>/
├── index/          # OpenSearch mock data (what the index returns)
├── graphql/        # GraphQL queries (.gql files)
├── expected/       # Expected JSON responses
└── test_<name>.py  # Test runner
```

For each relevant test:

1. **Index data** (`index/*.json`): Add the new field to the `_source` objects with realistic values (stored in the format OpenSearch would return — typically lowercase for enum values)
2. **GraphQL queries** (`graphql/*.gql`): Add the new field name to the query's selection set
3. **Expected responses** (`expected/*.json`): Add the field with the expected transformed value (e.g., uppercase for enums)

**Key test directories for endpoint fields**:
- `tests/end_to_end/camel_case_schema/test_unified_search_endpoint/` — searchHealthResources query
- `tests/end_to_end/camel_case_schema/test_return_endpoint/` — searchProviders query

### Step 6: Validate

1. Verify GraphQL schemas load without errors:
```python
python -c "
from ariadne import load_schema_from_path
from pathlib import Path
data_dir = Path('providersearch')
load_schema_from_path(str(data_dir.joinpath('graphql/classic/')))
print('Classic OK')
load_schema_from_path(str(data_dir.joinpath('graphql/sdk/')))
print('SDK OK')
"
```

2. Run the relevant test suite (requires Docker environment):
```bash
python -m pytest tests/end_to_end/camel_case_schema/test_unified_search_endpoint/ -x
python -m pytest tests/end_to_end/camel_case_schema/test_return_endpoint/ -x
```

## Examples

### Adding an enum subfield to Endpoint

**Scenario**: Add `connectionStatus` (available/unavailable) to the endpoint type.

**Changes**:
1. `base_document.py`: `connectionStatus = Keyword()` in `Endpoint` class
2. `schema_sdk.graphql`: Define `EndpointConnectionStatusEnum` enum, add `connectionStatus: EndpointConnectionStatusEnum` to `EndpointType`
3. `schema_classic_updated.graphql`: Same enum + field on `EndpointType`
4. `schema_classic.graphql`: Add `connectionStatus: EndpointConnectionStatusEnum` to `Endpoint` type (enum defined in other file)
5. `query_resolvers.py`: Add `to_upper("connectionStatus", obj)` resolver
6. Tests: Add `"connectionStatus": "available"` to index data, `connectionStatus` to queries, `"connectionStatus": "AVAILABLE"` to expected

### Adding a scalar top-level field

**Scenario**: Add `acceptingNewPatients` (boolean) to the search result.

**Changes**:
1. `base_document.py`: `acceptingNewPatients = Boolean()` on document class
2. All three `.graphql` files: `acceptingNewPatients: Boolean` on result type
3. No resolver change needed (boolean passes through)
4. Tests: Add field to index, query, and expected

## Dependencies

- Python with `opensearchpy` package (for `InnerDoc`, `Keyword`, `Nested`, etc.)
- Ariadne GraphQL library (for schema loading and resolver binding)
- Docker environment for running end-to-end tests

## Limitations

- This skill covers display-only fields. Adding filtering/scoring logic requires additional changes to `providersearch/query_builders/` and `providersearch/query_scorers/`.
- The classic schema has legacy naming conventions (e.g., `Endpoint` vs `EndpointType`) — always verify the type name in each schema file before adding fields.
- Test data uses mock OpenSearch responses — the actual index mapping update (for production) is a separate deployment concern not covered here.