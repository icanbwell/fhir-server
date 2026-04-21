# Unclassified Data Tagging (Upcoming)

Unclassified security tag will get added to the  specific resources on every write operation. It is based on configurable options mentioned below:

1. `ENABLE_UNCLASSIFIED_SENSITIVITY_TAGGING` is enabled
2. The resource type is in `RESOURCE_TYPE_FOR_UNCLASSIFIED_TAGGING`

The tag added to `meta.security`:

```json
{
  "system": "https://www.icanbwell.com/sensitivity-category",
  "code": "unclassified",
  "id": "<deterministic uuid>"
}
```

## Suppress Header

To suppress this behaviour, we can send `X-Suppress-Unclassified-Tag: true` header. This would only be supressed for non-patient-scoped JWT token.

## Interaction with Delegated Access

When `ENABLE_DELEGATED_ACCESS_DETECTION` is enabled, resources tagged `unclassified` are hidden from delegated users (see [delegatedActorAccess.md](delegatedActorAccess.md#filtering-of-unclassified-resources)).

## Config

| Variable | Type | Description |
|----------|------|-------------|
| `ENABLE_UNCLASSIFIED_SENSITIVITY_TAGGING` | boolean | Enables the feature |
| `UNCLASSIFIED_TAGGING_RESOURCES` | comma-separated string | Resource types that receive the tag (e.g., `Observation,Condition,Encounter`) |
