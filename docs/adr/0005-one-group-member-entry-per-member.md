# One Group Member Entry Per Member, Merged On Every Write

## Status

Proposed

## Context and Problem Statement

Consumers of `Group.member` need each member to appear once in a Group. Today:

- An embedded Group stores whatever `member[]` a write sends. A POST, PUT or `$merge` that lists a
  member twice stores both entries, and a PATCH `add` of a member already present appends a second
  entry and bumps the version.
- An extended Group (members in `GroupMember_4_0_0`, one row per member) applies only the last op
  when a PATCH sends several ops for one member. A bare re-add (no `inactive` sent) of an inactive
  member sets `inactive: false`. Groups become extended only while `ENABLE_EXTENDED_GROUP` is on.
  The flag is off by default and is on in staging only, so no client relies on extended Group
  behaviour today.

So the same request leaves a member in different states depending on the write path and on how the
Group is stored.

Two entries are the same member when their `entity.reference` resolves to the same uuid: the
`|<sourceAssigningAuthority>` in the reference if present, else the entity's
`_sourceAssigningAuthority`, else the Group's. `Patient/x`, `Patient/x|<owner>` and
`Patient/<uuid>` are one member; the same id under another owner is not.

## Decision Drivers

- One entry per member, whatever the write path: POST, PUT, `$merge`, PATCH, embedded or extended.
- A retried write leaves the Group as the first one did.
- One set of rules a client can predict, matching how `$merge` already combines a resource.
- No new error for payloads clients send today.

## Considered Options

- **A. Merge a member's entries with the `$merge` rules on every write.** `inactive` is an ordinary
  field and changes only when a write sends it.
- **B. Option A, but a bare re-add reactivates an inactive member** (`resolveInactive`), always or
  behind an opt-in.
- **C. Reject a write that lists a member twice** with a 400.
- **D. A later entry replaces the earlier one**; fields it does not send are cleared.

## Decision Outcome

Chosen option: **A**, because it gives one entry per member on every path with the rules `$merge`
already applies to a resource, keeps every retried write idempotent, and breaks no existing payload.

Rules:

- A member's entries are merged with `mergeObject`, oldest first: the newer entry's values win,
  fields only the older entry has are kept, objects such as `period` merge field by field, and
  arrays such as `extension` merge by `id`. The merged entry takes the position of the member's
  first entry.
- On a write over a stored Group, entries still as stored are the oldest, so the values the write
  sends win wherever they sit in `member[]`.
- `inactive` changes only when a write sends it. A client reactivates a member by sending
  `inactive: false`.
- Members already stored more than once are merged by the next write to the Group.
- An entry whose `entity.reference` is not a relative `Type/id` reference is stored as sent and not
  merged, since its uuid would not name one member.
- A write may send at most `GROUP_MEMBER_MAX_ENTRIES_PER_MEMBER` (default 100) entries for one
  member. Entries the Group already stores are not counted. A write over the limit fails with a 400
  before any entry is merged; in `$merge` that Group's result carries the error.
- A write whose members go to ClickHouse (the `useexternalstorage` header on a non-extended Group,
  with ClickHouse enabled for Group) keeps `member[]` as sent; that path diffs `member[]` itself.

The rules live in `mergeMemberEntry` and `mergeDuplicateMembers`
(`src/operations/common/groupMemberDedupe.js`). `GroupMemberMerger` applies them on the embedded
write paths, and `resolveMemberWrite` on the extended PATCH path.

### Consequences

- Good: each member appears once in every Group written after this change.
- Good: a retried PATCH `add` or `$merge` writes nothing and does not bump the version.
- Good: embedded and extended Groups resolve a member's writes the same way.
- Bad: a client that reactivated an extended member with a bare re-add must now send
  `inactive: false`. Extended Groups exist in staging only (`ENABLE_EXTENDED_GROUP`), so this
  changes no production client's behaviour.
- Bad: a write that lists a member twice succeeds with one stored entry. It is visible through the
  `Group member entries of the same member merged into one` log (Group id and counts only) and the
  `fhir_group_member_merge_entries_total` counter by `outcome` (`merged_away`, `left_as_is`,
  `no_change`, `rejected`). The counter has no tenant label, because metrics are never labelled by
  sourceAssigningAuthority.
- Bad: a write that sends more than 100 entries for one member now fails. Merging a member's
  entries costs more per entry as the merged entry grows (about 13 s for 4,000 entries with
  distinct extensions), so the limit keeps one write from holding a request thread. Rejections are
  counted with `outcome` `rejected`.
- Cost: a write that creates a Group hashes each member reference once (about 120 ms for 50,000
  members). A write over a stored Group reuses the `entity._uuid` preSave sets (about 10 ms for
  50,000 members).

## Pros and Cons of the Options

### A. Merge with the `$merge` rules

- Good: one rule set across every path, the same one `$merge` uses for the rest of the resource.
- Good: idempotent, and no request that works today starts failing.
- Bad: a duplicate in the payload is resolved silently, so it shows up only in logs and metrics.

### B. Merge, with reactivate-on-bare-add

- Good: keeps the extended PATCH behaviour for a bare re-add, which only staging has today.
- Bad: `inactive` becomes the one field that changes without being sent, on extended Groups only;
  the same `$merge` on an embedded Group keeps it.
- Bad: an opt-in adds a request flag every caller and path must carry, for one field.

### C. Reject duplicates

- Good: the client learns about the duplicate.
- Bad: payloads accepted today start failing, and a retried PATCH `add` of a present member fails.
- Bad: stored duplicates still need a merge rule.

### D. Replace

- Good: the stored entry is exactly the last one sent.
- Bad: an `add` that sends only `entity` clears the member's `period` and `extension`.
- Bad: differs from how `$merge` combines the rest of the resource.
