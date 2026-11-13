# Automatic Patch Release On Merge To main, Publishing Via workflow_dispatch

## Status

Accepted

Design details, verification and risks: `docs/specs/auto-release.md`.

## Context and Problem Statement

Releases are created by hand in the GitHub UI after every merge to `main`. The `publish_docker`
workflow runs on `release: created`, so no release means no Docker image. We want every merge to
`main` to create the next patch release and publish its image, with major and minor bumps staying
manual.

Two constraints shape how:

- A release created by a workflow with the default `GITHUB_TOKEN` does not trigger other workflows,
  so `publish_docker` would never start for a bot-made release.
- The README `publish_docker` badge shows the latest run on `main`. Runs triggered by a release are
  filed under the tag name, so the badge only ever saw the two runs that were filed under `main`,
  both failed, and it has been stuck on "failing".

## Decision Drivers

- Smallest change to a pipeline that works today.
- No new secret, token owner or admin-approved App.
- The badge should reflect real publishes without a hardcoded URL.
- An image must be built from the commit its version tag points at.

## Considered Options

- **A. Release workflow dispatches `publish_docker`.** A new `release.yml` creates the release, then
  starts `publish_docker.yml` with `workflow_dispatch` on `main`.
- **B. Create the release with a PAT or GitHub App token.** Such a token can trigger workflows, so
  `publish_docker` is unchanged.
- **C. One workflow tags, releases, builds and pushes.** `publish_docker` is retired or kept only for
  manual releases.

## Decision Outcome

Chosen option: **A**, because it is the smallest change, needs no new secret, and fixes the badge as
a side effect: dispatched runs are filed under `main`, so the existing badge follows real publishes.

The next version is the highest tag matching `^[0-9]+\.[0-9]+\.[0-9]+$` plus one patch. Custom tags
(`_`, `-`, ticket suffixes, a `v` prefix, extra segments) are never a base. A hand-cut major or minor
becomes the new base automatically. A run skips when its commit is already contained in the highest
version tag, so a re-run of an older failed run cannot tag older code as the newest version.

### Consequences

- Good: no new secret, and the manual-release path (`release: created`) keeps working.
- Good: the badge turns green after the first successful auto-publish on `main`.
- Bad: `publish_docker.yml` gains a second trigger and a tag input to validate. Its build step must
  set `context: .`, otherwise a dispatch builds `main`'s code under the tag.
- Bad: two merges close together publish in parallel, so `latest` can briefly sit on the older
  version until the next publish. See the spec's risks for the options considered.
- Bad: no automated test covers the version rule, which is two lines of shell in the workflow.

### Constraint for future changes

Do not move `release.yml` to a PAT or App token (option B) without also removing the dispatch step.
Such a token fires `release: created`, and every release would publish twice.

## Pros and Cons of the Options

### A. Dispatch from the release workflow

- Good: smallest diff, no secret, badge fixed.
- Bad: couples `release.yml` to `publish_docker.yml` by file name and input.

### B. PAT or GitHub App token

- Good: `publish_docker` untouched.
- Bad: a PAT is tied to one person, and an App needs admin approval.
- Bad: runs stay filed under tag names, so the badge still needs a separate workaround.

### C. One workflow does everything

- Good: the badge could point at `release.yml` and show the real push.
- Bad: biggest diff, rewrites a working pipeline, and renames the badge.
