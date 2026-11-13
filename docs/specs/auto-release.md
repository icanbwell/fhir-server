# Automatic Patch Release On Merge To main — Design

**Date:** 2026-11-13
**Status:** Approved

## Summary

Every push to `main` creates the next patch release (as a pre-release, with generated notes) and
publishes the Docker image for it, replacing the release that is created by hand in the GitHub UI
after each merge today. A major or minor release created by hand is picked up automatically: the
next merge continues from it. Separately, the `publish_docker` badge in the README stops showing
"failing" for successful publishes.

## Why

- Releases are created manually, one per merged PR (five on 2026-11-12 alone). Nothing in the repo
  automates it, and `publish_docker` only runs when a release is created, so no release means no
  image.
- The README `publish_docker` badge shows the latest run **on `main`**. `publish_docker` runs on
  `release: created`, so GitHub files almost every run under the tag name (`6.9.43`), not `main`.
  Only two runs were ever filed under `main` (`5.12.55`, Dec 2025, and `5.12.71`, Jan 2026), both
  failed, and they are the only runs the badge looks at. Recent publishes all succeed.

## Goals

- Each push to `main` produces exactly one new release `X.Y.Z+1` (pre-release, generated notes
  starting from the previous version tag) and publishes the Docker image for that tag.
- Only tags matching `^[0-9]+\.[0-9]+\.[0-9]+$` count as versions. Custom tags (`_test`, `-beta`,
  ticket suffixes, 4-part tags, a `v` prefix, non-version names) are never used as a base and never
  created.
- A major or minor release created by hand (`6.10.0`, `7.0.0`) becomes the new base: the next merge
  produces `6.10.1` / `7.0.1`.
- The README `publish_docker` badge reflects the latest publish for a merge to `main`.

## Non-goals

- No change to the Docker repository, image tags (`latest` plus the version), or platforms.
- Major and minor bumps stay manual. Nothing is derived from commit messages.
- No backfill of past releases, no notifications.

## Anti-goals (a failure even if it technically works)

- A duplicate tag, or a skipped or reused version, when two merges land close together.
- An image built from a commit other than the one the release tag points at.
- A double Docker publish for one release.
- A custom or test tag ever winning the version comparison.

## Constraints

- A release created with the default `GITHUB_TOKEN` does **not** trigger other workflows, so
  `publish_docker` cannot rely on its `release: created` trigger for bot-made releases.
- No tenancy, PHI, public API or event-contract impact. No new dependencies: `gh` is already on the
  runners, and no new third-party action is added.

## Approaches considered

- **A. Release workflow dispatches `publish_docker` (chosen).** A new `release.yml` creates the
  release, then starts `publish_docker.yml` with `workflow_dispatch` on `main`. Dispatched runs are
  filed under `main`, so the existing badge follows real publishes with no README URL change. Costs
  three small edits to `publish_docker.yml` and an `actions: write` permission. No new secrets.
- **B. Create the release with a PAT or GitHub App token.** `publish_docker` stays untouched because
  such a token can trigger workflows. Needs a new secret (a PAT is tied to one person, an App needs
  admin approval), and runs are still filed under tag names, so the badge needs a separate
  workaround.
- **C. One workflow tags, releases, builds and pushes.** The badge would point at `release.yml`.
  Biggest diff, rewrites a working pipeline, and renames the badge.

A was chosen: smallest change, no secrets, and the badge is fixed as a side effect.

## Design (A)

### `.github/workflows/release.yml` (new)

- Trigger: `push` to `main`.
- `concurrency: { group: release, cancel-in-progress: false }`. If several merges queue up, the
  newest pending run wins and its release notes cover everything since the previous version tag, so
  nothing is lost and no tag is duplicated.
- `permissions: contents: write, actions: write` (set explicitly, not left to repo defaults).
- The version rule is inline shell, with the version regex defined once as an environment variable
  and shared by every step that needs it:

  ```bash
  PREVIOUS=$(git tag -l | grep -E "$VERSION_RE" | sort -V | tail -1)
  NEXT="${PREVIOUS%.*}.$(( ${PREVIOUS##*.} + 1 ))"
  ```

  The step fails if `PREVIOUS` is empty rather than inventing a starting version.
- Steps: checkout with full history and tags, skip if the pushed commit already has a version tag
  (`git tag --points-at "$GITHUB_SHA"` filtered by the same regex), compute the next version, then
  `gh release create "$NEXT" --target "$GITHUB_SHA" --prerelease --generate-notes --notes-start-tag "$PREVIOUS"`,
  then `gh workflow run publish_docker.yml --ref main -f tag="$NEXT"`.
- Values reach `gh` through environment variables, never interpolated into the script text.

### `.github/workflows/publish_docker.yml` (edit)

- Add `workflow_dispatch` with a required `tag` input. Keep `release: created` so a hand-cut
  `6.10.0` still publishes.
- The skip guard for `_` and `-` tags uses `inputs.tag || github.event.release.tag_name`.
- A first step rejects a dispatched `tag` that is not `x.y.z`.
- Checkout uses `inputs.tag` as `ref`, so a dispatched image is built from the tagged commit even if
  `main` has moved. On the release path `inputs.tag` is empty, which `actions/checkout` treats as
  "use the default", so that path is unchanged. The Docker tag is `inputs.tag`, falling back to the
  existing get-previous-tag step, which now runs only on the release path.

### README

No change to the badge URL. The badge turns green after the first successful auto-publish on `main`
after this lands. A genuinely failing publish will turn it red, which is correct.

## Tests and verification

**No automated test is shipped for the version rule.** That is a deliberate choice: the rule is two
lines of shell inside a workflow, and extracting it only to make it testable was judged not worth a
separate file and test location. This departs from the org rule that every behavioral change ships
with tests, so the PR description should say so. Verification instead:

- Run the two-line pipeline locally against the repo's real tag list (about 1,770 tags, 185 of them
  custom) and against made-up lists covering: a plain patch bump, a manual minor bump (`6.9.43` +
  `6.10.0` gives `6.10.1`), a manual major bump (`7.0.0`), numeric rather than lexical ordering
  (`6.9.9` vs `6.9.10`, `6.9.100`), and ignored tags (`6.9.99_test`, `6.9.50-beta`,
  `2.8.6.EFS-1253`, `v2.1.212`, `3.1.63.1`, `onc-fhir-challenge`). Record the results in the PR.
- Run `actionlint` on the workflows if it is installed.
- The first merge to `main` after this lands is the real end-to-end check, and the PR description
  should say so.

## Calls made without being asked (check these)

- Runs are serialized, so close merges produce one release covering both.
- Release notes are pinned to the previous version tag with `--notes-start-tag`, so custom-tag
  releases don't change what a release's notes cover.
- The version step fails loudly when no version tag exists.
- Dispatch input validation, and a skip when the commit already has a version tag, are included.

## Risks and notes

- A tag or branch ruleset could block `GITHUB_TOKEN` from creating tags. That is not checkable
  without admin access and would show up on the first run.
- Do not move `release.yml` to a PAT or App token without removing the dispatch step. That token
  would also fire `release: created`, and every release would publish twice.
- Whether the default badge counts `workflow_dispatch` runs on `main` can only be confirmed after
  the first merge. If it doesn't, the fallback is `?event=workflow_dispatch` on the badge URL.
- A manual dispatch of an older `x.y.z` moves the Docker `latest` tag back to it. Creating a release
  for an old tag by hand already does the same today.
- With no automated test, a later edit to the tag filter can regress silently. The local
  verification above is the only guard until someone adds one.

## Left to the builder

Exact YAML and action versions (match the existing `actions/checkout` pin) and the wording of the
release title.
