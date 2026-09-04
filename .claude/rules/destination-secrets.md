---
paths:
  - "kill_the_clipboard_scanner/routers/destination_router.py"
  - "kill_the_clipboard_scanner/connectors/**/*.py"
  - "frontend/src/api/destination.ts"
  - "frontend/src/**/Destination*.tsx"
---

# Destination config: secrets never round-trip

`OrgDestination.config` is a free-form dict that holds connector credentials. The read
path and the write path each have a guard, and they depend on each other. Breaking one
silently breaks the other.

## The two guards

**Read — `_destination_to_dict` never returns a secret value.** The keys in
`_SECRET_CONFIG_KEYS` (`destination_router.py`) are stripped from every API response:

```
private_key_pem, client_secret, bearer_token, password,
google_refresh_token, microsoft_refresh_token, box_refresh_token,
auth_header, authHeader
```

**Write — `_reconcile_secret_fields` carries over what the admin didn't retype.** Because
the Edit form was populated from a response with the secrets stripped, it always submits
without them. Without this merge, **every update would silently erase the stored secret**.

## Consequences you must preserve

- There is deliberately **no way to clear a secret** through the form. To remove one,
  delete and recreate the destination. This is an accepted trade-off for not leaking it.
  `_reconcile_secret_fields` treats a blank/whitespace-only string the same as an absent
  key — both restore the stored value — so a showWhen-gated secret field (e.g. epic-hl7's
  client_secret, only shown under transport=http) cleared by toggling its trigger away and
  back without retyping the secret can't silently wipe it either.
- **Adding a new secret-bearing config key means adding it to `_SECRET_CONFIG_KEYS`.**
  Forget this and the value is returned in plaintext by `GET /api/settings/destinations`
  to anyone with the admin role — and it lands in browser history, logs, and any HAR file
  a support engineer collects.
- `authHeader` (camelCase) is in the set alongside `auth_header` on purpose. Match the
  casing the client actually sends; don't "clean up" one of them.
- For `DestinationType.EPIC_SMART`, `tenant_code` is forced back to the stored value on
  every update regardless of what the client sent. `regenerate_tenant_code_endpoint` is
  the only sanctioned way to change it.

## Epic credentials do not live here

`EpicFHIRConnector`'s `client_id` / `private_key_pem` come from the `EPIC_CLIENT_ID` and
`JWKS_PRIVATE_KEY` env vars — shared across every health system in an environment tier —
**not** from per-destination config. See `EpicFHIRConnector._auth_strategy` and
`docs/destination-verification/epic-bwell-registration.md`.

## The connector hierarchy

All implement `ConnectorProtocol`. `SMTPConnector` (aiosmtplib), `GoogleDriveConnector`,
`OneDriveConnector` (Microsoft Graph) and `BoxConnector` are standalone. The FHIR
destinations share a base hierarchy in `connectors/fhir/`:

- **`BaseFHIRConnector`** owns HTTP + pluggable auth (`auth.py`: `StaticHeaderAuth` /
  `BearerTokenAuth` / `JwtClientCredentialsAuth` / `ClientSecretCredentialsAuth`).
- **`FHIRBundleConnector`** (type `fhir`) resolves the patient via MRN lookup
  (`mrn_system` config, the same `find_patient_id` the Document connector uses), rewrites
  the outgoing Bundle's Patient references to the resolved `Patient/{id}`, then POSTs it.
- **`FHIRDocumentConnector`** (type `fhir-document`) files a PDF via
  lookup → `Binary` → `DocumentReference`.
- **`EpicFHIRConnector`** (type `epic`) subclasses the Document connector. It can be
  driven either by the Backend Systems app's `client_credentials` grant (the default —
  MRN search + date-window encounter lookup) or, when `ScanPayload.epic_smart_write_context`
  is set, by a SMART EHR-launch's own access token with an already-known patient/encounter.
  See `docs/destination-verification/epic-smart-on-fhir.md`.
- **`LocalFolderConnector`** writes bundles + PDFs through `FileStorage` (fsspec: `file://`
  on disk locally, `s3://` deployed — `FILE_STORAGE_ROOT`), keyed
  `<tenant_id>/<subdirectory>/<mrn>/<date>/<scan>/<file>` — grouped by patient MRN, then
  scan date, then individual scan, so repeat same-day scans don't collide. Each file is
  recorded as a `ScanFile` row, which is the source of truth for browse/download across
  pods (`/api/files` lists from the DB index and streams bytes through the app).
  `FileStorage` lives in `kill_the_clipboard_scanner/storage/` and is DI-registered and
  injected into `RoutingService`.

## Adding a connector

Implement `ConnectorProtocol`. **For a new EMR, subclass `FHIRDocumentConnector`** rather
than `BaseFHIRConnector` directly. Auth strategy is selected by
`build_document_auth_strategy`, whose inference order is: signed-JWT RS384 → symmetric
`client_credentials` → bearer token → static header → no auth.

For running/seeding the local FHIR server (`docker-compose-fhir.yml`) used by the
`fhir`-type destination in dev, see `docs/local-fhir-server-dev.md`.
