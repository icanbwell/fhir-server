# Unclassified Data Tagging (Upcoming)

On every write (create, update, merge, patch), the preSave pipeline can automatically add an `unclassified` sensitivity-category tag to configured resource types. The tag is added when:

1. `ENABLE_UNCLASSIFIED_SENSITIVITY_TAGGING` is enabled
2. The resource type is in `RESOURCE_TYPE_FOR_UNCLASSIFIED_TAGGING`
3. The `X-Suppress-Unclassified-Tag` header is not set for a non-patient scoped JWT

The tag added to `meta.security`:

```json
{
  "system": "https://www.icanbwell.com/sensitivity-category",
  "code": "unclassified",
  "id": "<deterministic uuid>"
}
```

## Suppress Header

System callers can send `X-Suppress-Unclassified-Tag: true` to prevent the tag from being added. This is intended for callers that classify resources and re-merge them. The header is only honored for non patient scoped JWT.

## Interaction with Delegated Access

When `ENABLE_DELEGATED_ACCESS_DETECTION` is enabled, resources tagged `unclassified` are hidden from delegated users (see [delegatedActorAccess.md](delegatedActorAccess.md#filtering-of-unclassified-resources)).

## Config

| Variable | Type | Description |
|----------|------|-------------|
| `ENABLE_UNCLASSIFIED_SENSITIVITY_TAGGING` | boolean | Enables the feature |
| `RESOURCE_TYPE_FOR_UNCLASSIFIED_TAGGING` | comma-separated string | Resource types that receive the tag (e.g., `Observation,Condition,Encounter`) |
