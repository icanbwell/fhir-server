---
status: accepted
date: 2026-11-12
---

# One write pipeline with per-operation profiles

## Context and Problem Statement

POST, PUT, PATCH, `$merge`, the `$import` worker and the admin resource writer each run their own
copy of the same write steps: scope check, find the stored resource, access checks, validation,
build the new document, attachments, write, audit, respond. The copies run the steps in different
orders, pick different variants of the same check, and skip different checks. Adding or changing a
check means finding and editing every copy, and a check that one copy is missing is hard to see.

How should the write operations share their steps so that every central check runs for every
operation, and the places where an operation differs can be read side by side?

## Decision Drivers

- A central check (scope, access, validation, audit) can't be skipped by one operation without
  that being visible in its code.
- Per-operation differences that are kept on purpose are written down in one place per operation.
- Each operation moves to the shared code on its own, and can be switched back without a deploy of
  new code, while the old code keeps running unchanged.
- Responses stay the same as today, apart from a short, announced list of accepted differences.

## Considered Options

- One pipeline plus per-operation profiles
- A base class with one subclass per operation
- A per-operation list of step objects
- Refactoring the old flows in place, without switches

## Decision Outcome

Chosen option: "One pipeline plus per-operation profiles", because it is the only option where the
order and the set of steps live in one function that no operation can change, while the
differences are plain data next to each other.

- `WritePipeline` (`src/operations/writePipeline/writePipeline.js`) calls each step explicitly, one
  line per step, in one fixed order. The step classes are in `writePipeline/steps/`. There is no
  step list and no loop.
- A profile (`writePipeline/profiles/<operation>.js`) is plain data: the operation name, the scope
  letter, the variant a step uses, and an explicit `off` for a check the operation does not run
  today. A profile can pick a variant of a step; it can't remove one.
- A responder (`writePipeline/responder/<operation>.js`) turns the item results into the
  operation's response and records its metrics. The shared `WriteAuditor` writes the audit events.
- `WRITE_PIPELINE_OPERATIONS` turns the new path on per operation (`create`, `update`, `patch`,
  `merge`, `import`, `admin`). With an operation's name absent, its old code runs exactly as
  before. `$merge` is the first operation; the others follow one PR each.

### Consequences

- Good, because a new check is added once, in a step, and runs for every operation that doesn't
  turn it off in its profile.
- Good, because each operation can be rolled back on its own by removing its name from
  `WRITE_PIPELINE_OPERATIONS`.
- Good, because the profiles show every kept difference between the operations in one folder.
- Bad, because the old and the new path both exist until every switch has been on everywhere, so
  a fix to a write flow may have to be made twice in that time.
- Bad, because the step order is fixed: a request that fails two checks can get a different one of
  the two errors than before, and `$merge` returns its results in request order instead of sorted
  by `_uuid`. These are listed in the spec's "Changes to announce".
- Bad, because tests that pin an accepted difference need two versions while both paths exist: the
  test updated to the new behavior, and an `oldWrite` copy that runs the old path.

### Confirmation

- Parity tests run each `$merge` case on both paths and compare the responses
  (`src/tests/integration/operations/writePipeline/responder/merge/`).
- The main CI job runs the whole suite with the shipped switches on (`jest/setEnvVars.js`). Tests
  that fail only on an accepted difference are updated and get an `oldWrite<Name>.test.js` copy
  that turns the switch off. No test is skipped.
- The CI job `coverage report` merges coverage across all test jobs. The old path's coverage with
  the switch on matches what the full suite gave it before.

## Pros and Cons of the Options

### One pipeline plus per-operation profiles

- Good, because the steps and their order are in one function, so a central check can't be
  skipped quietly.
- Good, because per-operation differences are data that can be read side by side.
- Bad, because a difference that isn't a variant of an existing step needs a new named variant in
  the shared step.

### A base class with one subclass per operation

- Good, because it is a familiar pattern and each operation's code stays together.
- Bad, because a subclass can override a step and quietly skip a check, which is what this work is
  meant to prevent.

### A per-operation list of step objects

- Good, because each operation's flow is easy to change.
- Bad, because each operation assembles its own list, so a missing check is easy to miss.

### Refactoring the old flows in place, without switches

- Good, because there is only one copy of each flow at any time.
- Bad, because there is no safe way to roll back per operation, and every PR risks changing
  responses.

## More Information

- Design: `docs/specs/unified-write-pipeline.md`
- Implementation plan: `docs/plans/unified-write-pipeline.md`
