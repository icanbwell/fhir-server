# Unclassified Data Tagging

Unclassified security tag will get added to the specific resources on every write operation when the resource type is in `UNCLASSIFIED_TAGGING_RESOURCES`.

The tag added to `meta.security`:

```json
{
  "system": "https://www.icanbwell.com/sensitivity-category",
  "code": "unclassified",
  "id": "<deterministic uuid>"
}
```

## Suppress Header

To suppress this behaviour, send the `X-Suppress-Unclassified-Tag: true` header. When suppressed, the tag is not added on write.

## Interaction with Delegated Access

When `ENABLE_DELEGATED_ACCESS_DETECTION` is enabled, resources tagged `unclassified` are hidden from delegated users (see [delegatedActorAccess.md](delegatedActorAccess.md#filtering-of-unclassified-resources)).

## Config

| Variable | Type | Description |
|----------|------|-------------|
| `UNCLASSIFIED_TAGGING_RESOURCES` | comma-separated string | Resource types that receive the tag (e.g., `Observation,Condition,Encounter`). Empty or unset disables the feature. |
