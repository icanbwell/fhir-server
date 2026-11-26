# Extended Groups: Group member storage

This page explains how the server stores the members of a Group, how a Group moves to extended
member storage, how each API writes and reads members in each kind of Group, the limits that apply,
and the behaviour callers should know about.

## 1. How Group members are stored

A Group is stored in one of two ways.

| Kind | Where the members live |
| --- | --- |
| **Regular Group** | Inside the Group document, in `member[]`. MongoDB limits one document to 16 MB, so this caps how many members the Group can hold. |
| **Extended Group** | In a separate collection, `GroupMember_4_0_0`, one row per member, with history in `GroupMember_4_0_0_History`. The Group document keeps every other field. |

Every Group starts as a regular Group. It becomes an extended Group when a PATCH takes its
`member[]` over `GROUP_MEMBER_PROMOTION_LIMIT` members. The server moves the members into
`GroupMember_4_0_0` within that PATCH and sets the internal `_extended: true` field on the Group.
Every response for an extended Group carries this tag in `meta.tag`; it is added when the Group is
read, not stored:

```json
{ "system": "https://www.icanbwell.com/groupSize", "code": "extended" }
```

A Group never goes back from extended to regular.

### The setting

Extended member storage is controlled by `ENABLE_EXTENDED_GROUP`, which is off by default.

- **Off:** every Group is a regular Group and no Group becomes extended. A Group that is already
  extended keeps its members, but they can't be read or changed (see section 7).
- **On:** Groups become extended as described above, and the limits in section 2 apply.

## 2. Configuration

| Setting | Default | What it controls |
| --- | --- | --- |
| `ENABLE_EXTENDED_GROUP` | Off | Turns extended member storage on or off |
| `GROUP_MEMBER_PROMOTION_LIMIT` | 50,000 | Most members a regular Group can hold while the setting is on. A PATCH that goes over it makes the Group extended; a POST, PUT or `$merge` that goes over it is rejected |
| `GROUP_PATCH_OPERATIONS_LIMIT` | 10,000 | Most member operations in one PATCH request to an extended Group |
| `GRAPHQL_GROUP_MEMBER_MAX_COUNT` | 50,000 | Most members in one GraphQL page for an extended Group |
| `GROUP_MEMBER_CASCADE_DELETE_BATCH_SIZE` | 1,000 | Members deleted per batch when an extended Group is deleted |
| `GROUP_MEMBER_MAX_ENTRIES_PER_MEMBER` | 100 | Most entries one write may send for the same member |

The error messages below are shown with the default values.

## 3. One entry per member

A Group holds at most one entry per member, on POST, PUT, `$merge` and PATCH, for both kinds of
Group. This does not depend on `ENABLE_EXTENDED_GROUP`.

- **Same member:** two entries are the same member when their `entity.reference` resolves to the
  same uuid. `Patient/x`, `Patient/x|<owner>` and `Patient/<uuid>` are one member; the same id under
  another owner is a different member.
- **Merging:** entries of the same member are combined the way `$merge` combines a resource. The
  newer entry's values win, fields only the older entry has are kept, objects such as `period` are
  merged field by field, and arrays such as `extension` are merged by `id`. `inactive` changes only
  when the newer entry sends it.
- **Order:** the merged entry takes the position of the member's first entry. Entries with no
  `entity.reference`, or one that isn't a relative `Type/id` reference, are kept as they are.
- **Limit:** a write that sends more than `GROUP_MEMBER_MAX_ENTRIES_PER_MEMBER` entries for one
  member is rejected with `400`:

```
Group.member has 101 entries for one member, more than the 100 allowed
```

## 4. Writing members

### 4.1 Create — `POST /4_0_0/Group`

A Group is created as a regular Group with the members sent in `member[]`. While the setting is on,
a Group with more than `GROUP_MEMBER_PROMOTION_LIMIT` members is rejected. Create it with fewer
members, then add the rest with PATCH.

```
400 too-costly
Limit exceeded (60000 > 50000). This operation is too costly to process in a single request.

Alternative approaches:
1. For writes: Use PATCH with JSON Patch to add members incrementally (example: [{"op":"add","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}}]). See: https://www.hl7.org/fhir/http.html#patch
2. For reads: Use pagination with _count parameter (example: GET /Group/{id}?_count=100)
3. For reads: Use streaming with _streamResponse=true for large result sets
```

### 4.2 Replace — `PUT /4_0_0/Group/{id}`

| Group | Behaviour |
| --- | --- |
| **Regular** | Replaces the whole Group, including `member[]`. More than `GROUP_MEMBER_PROMOTION_LIMIT` members is rejected (same error as 4.1). |
| **Extended** | Other fields (name, type, identifiers) can be changed. Sending `member` is rejected, because members can only be changed with PATCH. Sending no `member`, or `member: []`, is fine. |

```
400 too-costly
Group cohort-2026 stores its members in extended member storage, so PUT and $merge can only change its other fields. Use PATCH with JSON Patch to add members incrementally on /4_0_0/Group/cohort-2026 (example: [{"op":"add","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}}]). See: https://www.hl7.org/fhir/http.html#patch
```

### 4.3 Merge — `POST /4_0_0/Group/$merge`

| Group | Behaviour |
| --- | --- |
| **Regular** | The members sent are combined with the Group's existing members (section 3). If the Group would end up with more than `GROUP_MEMBER_PROMOTION_LIMIT` members, counting the members it already has, the request is rejected (same error as 4.1). |
| **Extended** | Other fields can be changed. Sending `member` is rejected (same error as 4.2). Sending no `member`, or `member: []`, is fine. |

Only the rejected Group fails. Its error is returned as that Group's entry in the `$merge` response,
and the other resources in the same request are still saved.

### 4.4 Add, change or remove members — `PATCH /4_0_0/Group/{id}`

PATCH is the only way to change the members of an extended Group, and the way a Group grows past
`GROUP_MEMBER_PROMOTION_LIMIT`.

**Regular Group.** Standard JSON Patch, including positions such as `remove /member/0`.
`GROUP_PATCH_OPERATIONS_LIMIT` doesn't apply. The members
are then merged (section 3). If the PATCH takes the Group over `GROUP_MEMBER_PROMOTION_LIMIT`
members, the server makes it an extended Group within the same request and returns `200`; the
response already has the extended tag and no `member[]`.

**Extended Group.** Members are added and removed by reference, not by position. Each member needs
its own operation on `/member/-` (or `/member/`):

```json
[
  { "op": "add",    "path": "/member/-", "value": { "entity": { "reference": "Patient/123" } } },
  { "op": "add",    "path": "/member/-", "value": { "entity": { "reference": "Patient/456" }, "inactive": true } },
  { "op": "remove", "path": "/member/-", "value": { "entity": { "reference": "Patient/789" } } }
]
```

- **Adding** a member who is already there doesn't create a duplicate; their entry is updated.
- **Reactivating** a member needs `add` with `"inactive": false`. A re-add without `inactive` leaves
  an inactive member inactive and changes nothing.
- **Removing** a member deletes their row and keeps it in history. To deactivate a member instead,
  send `add` with `"inactive": true`.
- **Removing** a member who isn't in the Group does nothing.
- If the same member appears more than once in one request, the operations are **applied in
  order**: each `add` is merged onto the member (section 3), and a `remove` clears it, so an `add`
  after a `remove` starts fresh.
- **One PATCH creates at most one new Group version**, whatever the number of operations. If
  nothing changes, no version is created.
- **The response** doesn't include the member list. Use `GET /Group/{id}` to see the members.

Errors on an extended Group:

| Case | Response |
| --- | --- |
| More than `GROUP_PATCH_OPERATIONS_LIMIT` member operations | `400 too-costly`: `Limit exceeded (12000 > 10000). ... For writes: Split into 2 batches of 10000 operations each` |
| A position path such as `/member/0`, or `add /member` with an array | `400 not-supported`: `Unsupported PATCH operation on Group.member: remove /member/0. Supported paths: "/member/" or "/member/-". ...` |
| An operation with no `value.entity.reference` | `400 required`: `Each member PATCH operation must include value.entity.reference` |
| The setting is off | `400`: `Group cohort-2026 uses a member-management feature that is disabled on this server.` |

### 4.5 Delete — `DELETE /4_0_0/Group/{id}` and `DELETE /4_0_0/Group?member=…`

| Group | Behaviour |
| --- | --- |
| **Regular** | Deletes the Group document, with the members stored inside it. |
| **Extended** | Deletes all of the Group's members first, `GROUP_MEMBER_CASCADE_DELETE_BATCH_SIZE` at a time, each kept in history, then the Group. Only one extended Group can be deleted per request. If the request fails part-way, send the same DELETE again to finish it. |

`DELETE /Group?member=…` matches the same Groups as `GET /Group?member=…`, extended Groups
included.

| Case | Response |
| --- | --- |
| The delete matches more than one extended Group. Nothing is deleted, including any regular Groups it matched | `400 too-costly`: `Delete matched 2 Groups in extended member storage. Deleting an extended Group also deletes all of its members, so deleting more than one in a single request is too costly to process. Delete them one at a time (example: DELETE /4_0_0/Group/{id}).` |
| The setting is off | `400`: `Cannot delete an extended Group while extended Group support is disabled` |

## 5. Reading members

A regular Group always includes `member[]`, wherever it is returned. An extended Group includes its
members only in these responses:

| Request | Members of an extended Group |
| --- | --- |
| `GET /Group/{id}` | **Full list**, streamed from `GroupMember_4_0_0` |
| `GET /Group/{id}/_history/{vid}` | **Full list**, as it was at that version: members added later are left out, members removed later are included |
| GraphQL `Group.member` | **One page** per request (see 5.2) |
| `PATCH /Group/{id}` response | Not included |
| `GET /Group/{id}/_history` | Versions saved before the Group became extended include their `member[]`; later versions have none |
| Search (`GET /Group?…`, `POST /Group/_search`) | Not included |
| `$everything` and `$graph` | Not included |
| `$export` (`Group.ndjson`) | Not included |

### 5.1 Finding a patient's Groups

- **Search by member** (`member=`, `member:not=`) finds both kinds of Group, including through
  inactive members.
- **`Patient/{id}/$everything`** and **`Person/{id}/$everything`** include the Groups the patient
  belongs to, extended Groups without their members.
- **`Patient/$graph`** follows Patient → Group links to both kinds of Group; extended Groups are
  returned with the tag and without their members.
- **`Group/{id}/$export`** exports every Patient in the Group, active and inactive. `Group.ndjson`,
  for Group and Patient exports, includes the Groups the exported Patients belong to, extended
  Groups without `member[]`.

### 5.2 GraphQL — `Group.member(_offset, _count)`

`member` accepts `_offset` and `_count` for both kinds of Group. A regular Group returns the
requested part of its list, or all of it without arguments. An extended Group returns one page at a
time:

| Limit | Behaviour |
| --- | --- |
| Page size | At most `GRAPHQL_GROUP_MEMBER_MAX_COUNT` members. With no `_count`, you get a full page. A larger `_count` is reduced to it, with no error. |
| Pages per request | **One** extended Group member page per GraphQL request. Use `_offset` to get the next page in a new request. |
| Empty page | `_count: 0` or a negative `_count` returns an empty `member` list and isn't counted as the request's one page. |

```graphql
query {
  group(_id: "cohort-2026") {
    entry {
      resource {
        id
        member(_offset: 0, _count: 1000) { entity { reference } inactive }
      }
    }
  }
}
```

A second extended Group member page in the same request (two extended Groups in one query, or the
same Group's `member` twice) doesn't fail the request. It returns `200` with its data; the first
extended Group gets its page, and every other extended Group `member` field is `null` with one
`errors[]` entry:

```
Only one extended Group member page can be read per GraphQL request
```

## 6. Example: building an extended Group

1. Create the Group with a few members:

   ```http
   POST /4_0_0/Group

   {
     "resourceType": "Group",
     "id": "cohort-2026",
     "meta": {
       "source": "http://example.org/Group",
       "security": [
         { "system": "https://www.icanbwell.com/owner", "code": "client1" },
         { "system": "https://www.icanbwell.com/access", "code": "client1" }
       ]
     },
     "type": "person",
     "actual": true,
     "member": [{ "entity": { "reference": "Patient/123" } }]
   }
   ```

2. Add members with PATCH. The Group becomes extended on the PATCH that takes it over
   `GROUP_MEMBER_PROMOTION_LIMIT` members; from then on, send at most
   `GROUP_PATCH_OPERATIONS_LIMIT` operations per PATCH.

   ```http
   PATCH /4_0_0/Group/cohort-2026

   [
     { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/456" } } },
     { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/789" } } }
   ]
   ```

3. Read the members with `GET /4_0_0/Group/cohort-2026`, or page through them with GraphQL.
4. Find a patient's Groups with `GET /4_0_0/Group?member=Patient/456`.
5. Delete the Group and all of its members with `DELETE /4_0_0/Group/cohort-2026`.

## 7. If the setting is turned off

Regular Groups work as usual. Extended Groups keep their members in `GroupMember_4_0_0`, but:

| Request | What happens |
| --- | --- |
| PATCH member operations | Rejected (`400`, see 4.4) |
| PUT / `$merge` with `member` | Still rejected (`400`, see 4.2) |
| DELETE | Rejected (`400`, see 4.5) |
| `GET /Group/{id}` and `_history/{vid}` | Returned **without members** |
| Search by member (`member=`, `member:not=`) | Extended Groups are **not found** |
| Other searches and GraphQL | Returned **without members**; GraphQL `member` is `null` |
| `$everything` and `$graph` | Extended Groups are **not returned** |
| `$export` | The export job **fails**: `Group cohort-2026 has extended membership but extended member storage is disabled; cannot resolve members for export.` |

No new Groups become extended, and the `GROUP_MEMBER_PROMOTION_LIMIT` check on POST, PUT and
`$merge` no longer applies.

## 8. Quick reference

| Goal | Request |
| --- | --- |
| Create a Group | `POST /4_0_0/Group` with a few members |
| Add members | `PATCH /4_0_0/Group/{id}` with `add` operations on `/member/-`; up to `GROUP_PATCH_OPERATIONS_LIMIT` per request once the Group is extended |
| Deactivate a member | `PATCH` with `add` on `/member/-` and `"inactive": true` |
| Remove a member | `PATCH` with `remove` on `/member/-` and the member's `entity.reference` |
| Change other Group fields | `PUT` or `$merge` without `member` |
| Read all members | `GET /4_0_0/Group/{id}` |
| Read members in GraphQL | `member(_offset, _count)`, one extended Group page per request |
| Find a patient's Groups | `GET /4_0_0/Group?member=Patient/{id}` |
| Delete a Group and its members | `DELETE /4_0_0/Group/{id}`, one extended Group per request |

## 9. Behaviour to know about

### Regular and extended Groups side by side

| Aspect | Regular Group | Extended Group |
| --- | --- | --- |
| Maximum members | Setting on: `GROUP_MEMBER_PROMOTION_LIMIT`. Setting off: as many as fit in 16 MB | No practical limit |
| Changing members | POST, PUT, `$merge` or PATCH | PATCH only |
| PATCH by position (`/member/0`) | Works | Rejected |
| PUT / `$merge` with `member` | Works | Rejected |
| Removing a member | Removed from `member[]` | Row deleted, kept in history |
| Adding the first member with PATCH | Fails on a Group created with no members (see below) | Not affected |
| Deleting the Group | One document is deleted | Members deleted in batches first; can time out (see below) |
| Members in responses | Always included | Only in `GET /Group/{id}` and `_history/{vid}`; one page in GraphQL |
| Turning the setting off | No effect | Members become unavailable |

### Adding the first member to a Group with no members

A Group created without a `member` field, or with `member: []`, has no member list. JSON Patch
(RFC 6902, §4.1) only allows `add` into an array that already exists, and `/member/-` means "append
to the end of the existing `member` array", so it fails when there is none (RFC 6902, Appendix
A.12):

```
400 invalid
Cannot perform an `add` operation at the desired path
name: OPERATION_PATH_CANNOT_ADD
index: 0
operation: { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/123" } } }
tree: { ...the Group as it is stored... }
```

This is standard JSON Patch behaviour, the same with the setting on or off. Create the Group with a
few members.

### Deleting an extended Group with many members

`DELETE /4_0_0/Group/{id}` responds only after every member is deleted. If that takes longer than
the client's or gateway's timeout, the client gets no response, but the server keeps going and
finishes the delete. `GET /4_0_0/Group/{id}` returns `404 not-found` once it is done. Sending the
same DELETE again is safe: it deletes any members still left and returns `204`.

## 10. How it works

### Storage

A regular Group is one document in `Group_4_0_0`, with its members in `member[]`. An extended Group
is one document in `Group_4_0_0`, with `_extended: true` and no `member[]`, plus one document per
member in `GroupMember_4_0_0`:

```json
{
  "resourceType": "GroupMember",
  "id": "<uuidv5 of groupUuid|member uuid>",
  "_uuid": "<uuidv5 of groupUuid|member uuid>",
  "meta": {
    "versionId": "3",
    "lastUpdated": "2026-11-20T09:00:00.000Z",
    "security": [
      { "system": "https://www.icanbwell.com/owner", "code": "client1" },
      { "system": "https://www.icanbwell.com/access", "code": "client1" }
    ]
  },
  "_sourceAssigningAuthority": "client1",
  "groupUuid": "<the Group's _uuid>",
  "member": {
    "entity": {
      "reference": "Patient/123",
      "_sourceId": "Patient/123",
      "_uuid": "Patient/<uuid>",
      "_sourceAssigningAuthority": "client1"
    },
    "inactive": true
  }
}
```

- **Id:** a member's row id is a UUIDv5 of the Group's `_uuid` and the member's uuid, so one member
  has exactly one row per Group.
- **Version:** `meta.versionId` and `meta.lastUpdated` are the Group version that last wrote the row.
  `meta.security` and `_sourceAssigningAuthority` are copied from the Group.
- **History:** every create, update and delete of a row is written to `GroupMember_4_0_0_History`.
  A removed member's history entry has `request.method: "DELETE"`. `GET /Group/{id}/_history/{vid}`
  rebuilds the member list of that version from this collection.

### Indexes

Defined in `src/indexes/customIndexes.js`:

| Collection | Index | Used by |
| --- | --- | --- |
| `GroupMember_4_0_0` | `groupUuid_1__uuid_1` | Reading a Group's members, GraphQL pages, `$export`, cascade delete |
| `GroupMember_4_0_0` | `member_entity_uuid_1` | Search by member with a uuid reference |
| `GroupMember_4_0_0` | `member_entity_sourceId_1` | Search by member with a plain reference |
| `GroupMember_4_0_0_History` | `groupUuid_1_uuid_1_lastUpdated_-1__id_1` | Rebuilding the member list of a past version |

### Tenant filtering

Lookups in `GroupMember_4_0_0` are not filtered by tenant. They only return Group uuids or rows of
a Group the caller has already loaded. Search by member joins those uuids back to `Group_4_0_0`, where
the caller's access tags and scopes are applied as for any other Group search, so a caller only sees
Groups it already has access to.

### Promoting a Group (PATCH over `GROUP_MEMBER_PROMOTION_LIMIT`)

The PATCH is applied to `member[]` and the members are merged. If the Group is then over the limit,
`promoteExistingGroupIfNeeded` writes one `GroupMember_4_0_0` row per member, stamped with the new
Group version, removes `member[]`, sets `_extended: true`, and the Group is saved with that version.

The member rows are written before the Group. If the Group write fails, the Group stays regular and
over the limit, and the next PATCH that crosses the limit promotes it again, reusing or replacing
the rows already written.

### Reading an extended Group (`GET /Group/{id}`)

The Group is read from `Group_4_0_0` with the caller's access filters. Its rows are then read from
`GroupMember_4_0_0` by `groupUuid` and written into the response's `member[]` one by one. The members
are written to the response as they are read, so the server never holds the whole list
in memory.

### Search by member (`GET /Group?member=…`)

`GroupMemberQueryRewriter` widens each `member` condition `C` in the query to

```
$or: [ C, { _uuid: { $in: <groupUuid of every GroupMember_4_0_0 row matching C> } } ]
```

so one query matches regular Groups through `member[]` and extended Groups through their rows. The
access filters stay around `C` and apply to both branches. `member:missing` matches `member[]` only.

### Deleting an extended Group

`remove.js` calls `cascadeDeleteForGroupAsync`, which reads `GROUP_MEMBER_CASCADE_DELETE_BATCH_SIZE`
rows of the Group at a time, writes a history entry for each and deletes them, until none are left.
It then deletes the Group. If a pass finds rows but deletes none, it waits and retries, and gives up
after 10 such passes, leaving the Group in place so that a repeated DELETE carries on.

## 11. Code map

| Area | Code |
| --- | --- |
| Promotion and the POST/PUT/`$merge` limit | `src/utils/groupPromotion.js` |
| PATCH routing and extended member writes | `src/operations/patch/strategies/groupMemberPatchStrategy.js` |
| Member rows, reads and cascade delete | `src/dataLayer/repositories/mongoGroupMemberRepository.js` |
| One entry per member | `src/operations/common/groupMemberMerger.js`, `src/operations/common/groupMemberDedupe.js` |
| Search by member | `src/queryRewriters/rewriters/groupMemberQueryRewriter.js` |
| Streaming the member list on read | `src/operations/streaming/resourceWriters/groupMemberArrayWriter.js` |
| GraphQL paging | `src/utils/graphqlGroupMemberPaging.js` |
| Extended field | `src/utils/mongoGroupExtendedTag.js` |
| Extended tag on responses | `src/enrich/providers/groupExtendedTagEnrichmentProvider.js` |
| Error texts | `src/utils/fhirErrorFactory.js` |
| Settings | `src/utils/configManager.js` |
| Indexes | `src/indexes/customIndexes.js` |
| Read by id | `src/operations/searchById/searchById.js` |
| Delete | `src/operations/remove/remove.js` |

## 12. Related documentation

- [FHIR Group resource](https://www.hl7.org/fhir/group.html)
- [FHIR PATCH](https://www.hl7.org/fhir/http.html#patch) and [JSON Patch, RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)
- [Merge](./merge.md)
- [Streaming](./streaming.md)
