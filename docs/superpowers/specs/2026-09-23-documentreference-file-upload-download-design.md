# DocumentReference `$fileUpload` / `$fileDownload` — Signed S3 URL Attachments — Design

Ticket: [DCON-5654](https://icanbwell.atlassian.net/browse/DCON-5654)

## Background

`DocumentReference.content[].attachment` today only supports inline base64 data (transparently
round-tripped through MongoDB GridFS by `src/dataLayer/databaseAttachmentManager.js`, already
registered for `DocumentReference` in `src/dataLayer/generated.databaseAttachmentResources.json`)
or an already-hosted external `url` the client supplies out of band. There is no way for a client
to upload or download large file content directly to/from external storage without routing the
bytes through the FHIR server itself, and no presigned-URL code exists anywhere in this repo today
— `@aws-sdk/s3-request-presigner` isn't even a dependency yet. All existing S3 usage
(`src/utils/s3Client.js`, `historyResourceCloudStorageClient`, `base64FieldCloudStorageClient`)
proxies bytes through the server.

No HL7 FHIR core operation or IG standardizes this pattern. The closest prior art:

- **Medplum's `$presigned-url`** — `GET Binary/[id]/$presigned-url?upload=true|false`, returns a
  `Parameters` resource with a `url` output parameter. Scoped to the `Binary` resource, not
  `DocumentReference` directly; explicitly documents the URL as unauthenticated once issued.
- **HAPI FHIR / Smile CDR's `$binary-access-write` / `$binary-access-read`** — vendor extensions
  (not HL7 core) using a `path` FHIRPath parameter to target an `Attachment` inside any resource.
  Different mechanism: bytes are proxied through the FHIR server, not handed off via a signed URL.

Neither is reusable as-is. This is a bespoke design.

## Scope

Add two new custom operations, scoped to `DocumentReference` only, disabled by default:

- `POST DocumentReference/{id}/$fileUpload` — mint a presigned S3 **PUT** URL and append a new
  `content[]` entry to the resource.
- `GET DocumentReference/{id}/{contentId}/$fileDownload` — redirect to a presigned S3 **GET** URL
  for a previously-uploaded `content[]` entry.

Explicitly out of scope (YAGNI, revisit only if a real need shows up):

- Any resource type other than `DocumentReference`.
- Any cloud storage provider other than S3 (matches the existing base64-blob-storage feature,
  which also only has an S3 provider today).
- An upload-completion confirmation/webhook — `$fileUpload` appends the `content[]` entry
  optimistically, before the client has actually uploaded anything; `$fileDownload` tolerates this
  (see Error Handling).
- Multipart upload, retry, or resumable-upload support.
- Virus/malware scanning of uploaded content.
- `contentType` inference from file extension — only set if the caller explicitly supplies it.
- Replacing or touching the existing GridFS-backed inline-`data` attachment path — this is a new,
  parallel path (`attachment.url` populated instead of `attachment.data`), not an extension of it.

## Architecture

**Chosen approach:** `Attachment.url` is set to the resource's own `$fileDownload` operation URL
(`.../DocumentReference/{id}/{contentId}/$fileDownload`), not a raw S3 path. Any generic FHIR
client can follow `Attachment.url` exactly as it normally would and transparently lands on the
file via a 302 redirect. A new, dedicated S3 bucket/config is used, mirroring the existing
`historyResourceCloudStorageClient` / `base64FieldCloudStorageClient` registration pattern in
`src/createContainer.js`, rather than repurposing an existing bucket.

Two alternatives were considered and rejected:

- **Reuse the existing base64-offload bucket** (`base64FieldCloudStorageClient`'s bucket) instead
  of provisioning a new one. Rejected: that bucket exists for internal, server-mediated blob
  offload with its own lifecycle assumptions; repurposing it for direct client PUT/GET blurs two
  different concerns.
- **Store the raw S3 key/path in `Attachment.url`** instead of an operation URL. Rejected: leaks
  internal bucket/key structure to anyone who reads the resource, and breaks normal FHIR client
  ergonomics — a generic client following `Attachment.url` per spec would get a non-working
  reference instead of the file.

## Components & data flow

New/changed files:

- `src/utils/s3Client.js` — add `getPresignedPutUrlAsync({key, contentType, expiresInSeconds})`
  and `getPresignedGetUrlAsync({key, expiresInSeconds})`, using `getSignedUrl` from the new
  `@aws-sdk/s3-request-presigner` dependency wrapping `PutObjectCommand`/`GetObjectCommand`.
- `src/createContainer.js` — register `documentReferenceFileCloudStorageClient`, conditionally
  `null` when the feature flag is off (same shape as `historyResourceCloudStorageClient`).
- `src/utils/configManager.js` — new getters: `enableDocumentReferenceFileOperations` (single flag
  gating both operations), `documentReferenceFileBucketName`,
  `documentReferenceFileUploadUrlExpiryInSeconds`, `documentReferenceFileDownloadUrlExpiryInSeconds`
  (sensible defaults, e.g. 900s/15min each).
- `src/operations/fileUpload/fileUpload.js` — new `FileUploadOperation` class.
- `src/operations/fileDownload/fileDownload.js` — new `FileDownloadOperation` class.
- `src/operations/fhirOperationsManager.js` — new `fileUpload(args, {req,res}, resourceType)` /
  `fileDownload(args, {req,res}, resourceType)` methods, following the existing `accessHistory`
  shape.
- `src/profiles.js` — hand-add to the `DocumentReference` block:
  `{ name: 'file-upload', route: '/:id/$fileUpload', method: 'POST' }` and
  `{ name: 'file-download', route: '/:id/:contentId/$fileDownload', method: 'GET' }`.
- `package.json` — add `@aws-sdk/s3-request-presigner` (version-matched to the existing
  `@aws-sdk/client-s3` at `^3.1053.0`), then `make update`.

**`$fileUpload` data flow:**

1. Feature-flag check (`configManager.enableDocumentReferenceFileOperations`) — `NotFoundError` if
   off, matching the `$access-history` precedent (`src/operations/accessHistory/accessHistory.js`).
2. Load the DocumentReference by id (same query/find pattern as `update.js`/`patch.js`) —
   `NotFoundError` if missing.
3. Standard write access/patient-scope check — the same
   `isAccessToResourceAllowedByAccessAndPatientScopes` call `patch.js` already makes. No new scope
   type is introduced (confirmed with the user — reusing standard DocumentReference scopes was the
   explicit choice over adding a dedicated file-operation scope).
4. Parse the request body as a `Parameters` resource with optional `fileName` (`valueString`) and
   `contentType` (`valueString`) input parameters, e.g.:
   ```json
   {"resourceType":"Parameters","parameter":[{"name":"fileName","valueString":"report.pdf"},{"name":"contentType","valueString":"application/pdf"}]}
   ```
5. Generate `contentId` (uuid). **Sanitize `fileName`** — reject/strip path separators (`/`, `\`),
   `..` sequences, and control characters, and cap length — before it is used in an S3 key (see
   Error Handling & Security).
6. Build the S3 key: `DocumentReference_4_0_0/{resourceUuid}/content/{contentId}/{fileName}` (or
   without the trailing segment if no `fileName` was supplied).
7. Presign a PUT for that key, binding `Content-Type` only if the caller supplied one.
8. Clone the resource, append a `content[]` entry:
   `id` = `contentId`, `attachment.url` = this resource's own `$fileDownload` URL,
   `attachment.title` = `fileName` if given, `attachment.contentType` = if given,
   `attachment.creation` = now.
9. `resourceMerger.updateMeta` (version bump), then persist via `databaseBulkInserter
   .replaceOneAsync` + `.executeAsync` — the same load→clone→mutate→persist shape used by
   `GroupMemberPatchStrategy.executeMemberOperations` for array-append updates.
10. Respond with plain JSON `{ contentId, uploadUrl, expiresAt }` (not a FHIR `Parameters`
    resource on the way out — no IG mandates one, and the existing generic writer,
    `fhirResponseWriter.readCustomOperation`, just does `res.json(result)`).

**`$fileDownload` data flow:**

1. Feature-flag check — `NotFoundError` if off.
2. Load the DocumentReference by id — `NotFoundError` if missing.
3. Standard read access/patient-scope check (same as `searchById.js`).
4. Find the `content[]` entry whose `id` matches the `contentId` path segment — `NotFoundError` if
   absent. **This lookup is also the IDOR guard**: a `contentId` only resolves inside its own
   resource's `content[]` array, never as a free-floating S3 key.
5. Rebuild the same S3 key from `resourceUuid` + `contentId` + `attachment.title`.
6. `HeadObjectCommand` the key first — if it 404s (upload never completed), return `NotFoundError`
   with a clear message rather than redirecting to a URL that will fail at S3.
7. Presign a GET for the key.
8. `res.redirect(302, url)` directly on the raw Express response object. Confirmed clean: the
   controller (`src/middleware/fhir/4_0_0/controllers/operations.controller.js`) passes `res`
   straight into the operation method, and `fhirResponseWriter.readCustomOperation` already
   no-ops when `res.headersSent` is true — no controller changes needed.

## Error handling & security

- Flag off → `NotFoundError` on both operations (looks like a route that doesn't exist, matching
  the `$access-history` precedent).
- Resource missing / access denied → same errors and ordering as the existing `update`/
  `searchById` paths; no new behavior introduced.
- Unknown `contentId` on `$fileDownload` → `NotFoundError`. Safe to be specific here (as opposed to
  a generic resource-not-found) since the caller already passed the parent-resource access check —
  this doesn't leak cross-tenant information.
- Upload never completed (S3 `HeadObjectCommand` 404) → `NotFoundError` on `$fileDownload`, rather
  than a broken redirect.
- **`fileName` is attacker-controlled and gets embedded directly into an S3 key.** It must be
  validated/sanitized in `FileUploadOperation` before use — reject or strip path separators, `..`
  sequences, and control characters, and cap length. Otherwise a crafted `fileName` could write
  outside the intended `content/{contentId}/` prefix.
- Per `review.md`'s write-path guidance (§3.C): this feature does not introduce any new
  access-tag/scope quantifier logic — it reuses the exact same
  `isAccessToResourceAllowedByAccessAndPatientScopes` check as existing write (`patch.js`) and read
  (`searchById.js`) paths, so no new gap is introduced there. The one genuinely new
  security-relevant surface is the `fileName`-into-S3-key path above.
- Presigned URLs are inherently bearer credentials once issued (anyone with the link can use it
  until expiry) — this is accepted, matching Medplum's documented behavior for the same pattern.
  Expiry is kept short (config default 15 minutes for both directions) to bound the exposure
  window.

## Testing strategy

Integration tests via `createTestRequest`, covering:

1. Flag-off → 404 on both operations.
2. Happy path: `$fileUpload` → presigned PUT URL + `content[]` entry appended → `$fileDownload` →
   302 to a presigned GET URL for the same content.
3. Missing/insufficient write scope on `$fileUpload`; missing/insufficient read scope on
   `$fileDownload`.
4. Unknown `contentId` on `$fileDownload` → 404.
5. Path-traversal / invalid `fileName` on `$fileUpload` → rejected before any S3 call.
6. `$fileDownload` called before the client actually PUTs to the presigned URL → 404 (HEAD check).
7. `$fileUpload` called twice on the same resource → two independent `content[]` entries, each
   with its own `contentId`-scoped S3 key (no collision possible by construction).

S3 interaction in tests should mock/stub `S3Client` the same way the existing
`base64FieldCloudStorage` tests do — the exact fixture/pattern to reuse is to be confirmed while
writing the implementation plan (see Open Items).

## Open items / verify during implementation

- Confirm the exact existing test double/mocking pattern used for `S3Client` in
  `base64FieldCloudStorage`-related tests, so `$fileUpload`/`$fileDownload` tests follow the same
  convention rather than inventing a new one.
- Confirm default expiry values (currently proposed: 15 minutes for both upload and download URLs)
  are acceptable, or whether upload vs. download should differ.
- New S3 bucket provisioning (actual infra creation) is outside this repo's scope — confirm the
  bucket name/region convention with whoever owns infra provisioning before merging the config
  defaults.
