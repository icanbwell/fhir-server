---
name: pipeline-config-sync
description: Sync a Prefect deployment's live configuration back into its corresponding pipeline_config.json in helix.orchestration. Use this whenever the user wants to reconcile drift between Prefect (where ops can edit deployments via the UI) and the helix.orchestration repo (the canonical source-of-truth for those configs). Trigger on phrases like "sync pipeline config", "update pipeline config from Prefect", "reconcile <deployment> with code", "pipeline config drifted", or whenever the user mentions a Prefect deployment name and asks to bring the JSON in line with what's live. The skill detects which Prefect environment (prod / staging / dev / client-sandbox) is connected via MCP and announces it before doing anything — the JSON has env-specific overlays (`prod_args`, `staging_args`, etc.), so getting the env right is what makes the diff real instead of noise. Reads, diffs, asks for approval, then edits the JSON file. Does NOT push or open a PR — leaves git operations to the user.
when_to_use: "Reconciling a helix.orchestration pipeline_config.json with the live Prefect deployment after the deployment was edited via the Prefect UI. Run this when you suspect or know configuration has drifted from code."
user-invocable: true
argument-hint: "<deployment-name> [--env prod|staging|dev|client-sandbox]"
allowed-tools: Read Edit Bash Glob Grep mcp__prefect__get_deployments mcp__prefect__get_flow_runs mcp__prefect__get_identity
effort: medium
---

# Pipeline Config Sync

You are bridging two sources of truth for Helix pipeline configurations:

- **Prefect** (live deployment state, mutable from the UI) — the *what's actually running*.
- **`helix.orchestration/pipeline_configs/**/pipeline_config.json`** (the file that should regenerate that deployment) — the *what we say is running*.

When ops edits a deployment from the Prefect UI (bumping executors during an incident, tweaking a pipeline param, retiming the schedule), those edits do not round-trip back to the JSON file. Drift accumulates silently. The next time someone redeploys from code, the UI edits get clobbered.

Your job: pull the live Prefect config, diff it against the JSON file, show the user what's drifted, and — once they approve — write the changes into the JSON. You stop there. The user runs `git add` / `git commit` / `gh pr create` themselves.

## What to sync (and what NOT to)

**Sync these fields** — these are the ones that drift:

- `parameters.pipeline_params` — the long list of `--flag=value` strings. Highest-drift area; most UI tweaks land here.
- `parameters.executors`, `parameters.driver_memory`, `parameters.spark_memory` — Spark sizing. Often bumped under load and forgotten.
- `schedule` — the cron expression / interval. Retimings frequently happen via UI.

**Leave these alone** unless the user explicitly asks:

- `parameters.pipeline_module` — code-defined; should not drift.
- `parameters.pipeline_name` — naming, not config.
- `tags` — low drift; if you notice a difference, mention it but don't write it.
- `local_args`, `dev_args`, `staging_args`, `pre-prod_args`, `client-sandbox_args`, `prod_args` — these are environment-overlay sections used by the build process; they do **not** correspond 1:1 to anything in Prefect's deployment record. You cannot reverse-engineer which list a given Prefect param came from. If you see a param in Prefect that isn't in `parameters.pipeline_params`, check the env-specific `*_args` lists for the active env *before* concluding it's drift — see step 4 below.
- `*_parameters_overrides` — same reasoning as above. They overlay on top of `parameters` at deploy time.

## Workflow

### 1. Detect and announce the connected Prefect environment

**This is the most important step. Do not skip it and do not guess.** The JSON file has env-specific overlay sections (`prod_args`, `staging_args`, `dev_args`, `client-sandbox_args`, plus `prod_parameters_overrides`, `client-sandbox_parameters_overrides`, etc.). The diff is only meaningful if you reconcile against the *correct* overlay. Comparing prod-flavored JSON against a staging Prefect connection produces a flood of false-positive "drifts" — every staging org ID and S3 path looks like drift when it isn't.

The Prefect MCP is connected to exactly one workspace (env) per session. You can't choose; you can only detect. There are two signals — use both:

**1a. Ask the MCP directly.** This is the authoritative source.

```
mcp__prefect__get_identity()
```

The response should include account/workspace identifiers. Look for the workspace name or URL — it usually contains the env (e.g. `prod`, `staging`, `dev`, `client-sandbox`).

**1b. Cross-check with deployment-data fingerprints.** After you fetch the live deployment in step 4, the `parameters` dict (and especially `pipeline_params`) carries clear env tells. Use this table to confirm — and if the fingerprints disagree with the env you announced from `get_identity`, **stop and re-announce** before continuing into the diff:

| Signal in Prefect | prod | staging | dev | client-sandbox |
|---|---|---|---|---|
| `bwell_organization_id` (default/value) | `078cf112-f802-4e4b-9b62-ed44cdf05d27` | `c9511013-0862-4cdd-a466-c6e028d42bf1` | `c08bf3b8-8949-4f94-a013-cc490873f4ea` | `a7a9c609-6bef-4599-9f83-8aed9390a08d` |
| S3 path prefix | `s3://bwell-helix-data-lake-ue1/...` (no env in name) | `s3://bwell-staging-helix-data-lake-ue1/...` | `s3://bwell-dev-helix-data-lake-ue1/...` | `s3://bwell-helix-data-lake-client-sandbox-ue1/...` |
| `token_service_url` | `aperture-token-service-pipelines.prod.bwell.zone` | `...staging.bwell.zone` | `...dev.bwell.zone` | `...client-sandbox.bwell.zone` |

If `get_identity` and the fingerprints agree, you're good. If they conflict (rare — usually means someone is testing with mixed configs), trust the fingerprints over `get_identity` and call out the conflict for the user.

**1c. Announce it.** Before doing any diffing, tell the user, plainly:

```
Connected Prefect MCP: <env> (detected via <get_identity | data fingerprint>)
Will reconcile against the JSON's <env>_args / <env>_parameters_overrides overlays.
If this is wrong, stop me now.
```

If the user wants a *different* env's view, they need to reconfigure the MCP — this skill cannot switch envs mid-session. Tell them so and stop.

The user's CLI args (`--env prod`) only become relevant when the MCP is connected to a *multi-env* workspace, which is unusual; if the user passes `--env` and the detected env disagrees, surface the conflict and ask before proceeding.

### 2. Resolve the deployment name

The user gives you a deployment name. The `deployment_name` in the JSON file is exactly the `name` field on the Prefect deployment object. They match verbatim, including capitalization and spacing (e.g. `"High Resource Tokens - Provider Existing Patient Access Pipeline"`).

### 3. Find the JSON file

This skill ships inside the `helix.orchestration` repo, so the repo root is wherever Claude Code is running. Resolve it once with `git rev-parse --show-toplevel` (call it `$REPO`) and search under its `pipeline_configs/`:

```bash
REPO=$(git rev-parse --show-toplevel)
grep -rln "\"deployment_name\": \"<exact-name>\"" "$REPO/pipeline_configs/"
```

If multiple files match (rare but possible — different versions of a pipeline can share a name across subfolders), list them and ask the user which one. Don't guess.

If zero files match, try a case-insensitive search on a distinctive substring of the name:

```bash
grep -rli "<distinctive-substring>" "$REPO/pipeline_configs/"
```

If still nothing: tell the user the deployment exists in Prefect but has no corresponding JSON file in the repo. That's a different kind of drift — outside this skill's scope. Stop.

### 4. Fetch the live Prefect deployment

```
mcp__prefect__get_deployments(filter={"name": {"any_": ["<exact-deployment-name>"]}})
```

The default response is a *summary* and **does not include `parameters`**. To get the full deployment record you need for diffing, follow up with an id-filtered call:

```
mcp__prefect__get_deployments(filter={"id": {"any_": ["<deployment-id-from-step-above>"]}})
```

This returns the full `parameters` dict, `parameter_openapi_schema`, `job_variables`, work-pool details, and recent runs.

Capture from the result:

- `parameters` — the full dict. The keys you care about: `pipeline_params` (list of strings), `executors`, `driver_memory`, `spark_memory`. Other keys may exist; preserve them mentally but don't try to sync them unless they overlap with the sync scope above.
- `schedule` (and `schedules` — Prefect 2.x can have multiple). Most deployments have one cron schedule; if there are multiple, show all of them in the diff.
- `work_pool_name`, `tags`, `id` — for context only, not for syncing.

If `get_deployments` returns more than one match (e.g. similarly named deployments in the same workspace), show the user the candidates with `id` + `work_pool_name` and ask which one. **Do not pick silently.**

If `get_deployments` returns zero: confirm you used the exact name from the JSON's `deployment_name` field. If still empty, the deployment doesn't exist in the env you're querying — tell the user and stop.

### 5. Build the diff

This is the core of the skill. Compare Prefect's view to the JSON's view, but be careful about *where* in the JSON each piece lives.

#### 5a. `pipeline_params` diff

The Prefect deployment's `parameters.pipeline_params` is what's *actually being passed at runtime*. In the JSON file, it is constructed at deploy time as roughly:

```
parameters.pipeline_params  +  <env>_args  +  flatten(<env>_parameters_overrides)
```

So before flagging a Prefect param as "drift", check if it appears in any of these JSON sources for the active env:

- `parameters.pipeline_params` (base list)
- `<env>_args` (e.g. `prod_args`)
- `<env>_parameters_overrides` (e.g. `prod_parameters_overrides`)

A param is **drifted** only if its `--key=value` form is present in Prefect but NOT present in *any* of those three JSON sources, OR if the value differs.

For each drifted param, classify it:

- **Modified value** — same `--key`, different `=value`. Most common.
- **Added in Prefect** — `--key` doesn't exist anywhere in the JSON.
- **Removed in Prefect** — `--key` exists in the JSON but not in Prefect's runtime params.

**Write-target rule** — where to put the change in the JSON:

- **Modified value, param exists in `<env>_args` or `<env>_parameters_overrides`:** edit it *in place* in that overlay. You know its home — use it. Writing the new value to `parameters.pipeline_params` instead would create a contradictory pair (e.g. `--run_intelligence_layer=False` in base, `=True` in `staging_args`) which is worse than the original drift.
- **Modified value, param exists only in `parameters.pipeline_params` (the base list):** edit it in place there.
- **Modified value, param exists in *both* base and an overlay:** edit the overlay (the overlay wins at deploy time, so that's the value Prefect is actually seeing).
- **Added in Prefect (param doesn't exist anywhere in the JSON):** append to `parameters.pipeline_params`. In the diff summary, note: "If any of these belong in `<env>_args` or `<env>_parameters_overrides` instead, move them manually before committing."
- **Removed in Prefect:** delete the param from wherever it lives (base or overlay). Confirm with the user before doing this — removed-in-Prefect can occasionally mean ops disabled a flag temporarily, not that the code should drop it.

Always state the write target for each line in the diff (e.g. `lives in staging_args` / `lives in parameters.pipeline_params`) so the user can sanity-check before approving.

#### 5b. Infra fields diff

Compare Prefect's `parameters.executors` / `driver_memory` / `spark_memory` to the JSON's `parameters.executors` / `driver_memory` / `spark_memory` directly. These are not env-overlaid (or if they are via `*_parameters_overrides`, the override takes precedence — surface that in the diff if relevant).

#### 5c. Schedule diff

Prefect's schedule shape varies. Two common forms:

- `{"cron": "45 6 * * *", "timezone": "UTC", ...}` — cron schedule.
- `{"interval": <seconds>, "anchor_date": "...", ...}` — interval schedule.

The JSON file represents schedules as:

```json
"schedule": { "type": "cron", "value": "45 6 * * *" }
```

When building the diff:

- Cron in Prefect, cron in JSON, different value → modified.
- Cron in Prefect, no schedule in JSON → added.
- No schedule in Prefect, cron in JSON → removed (deployment was un-scheduled — confirm with user before writing this; might be intentional pause).
- Different timezone → flag it; the JSON shape doesn't carry timezone, so warn the user.
- Interval-based schedule in Prefect → tell the user the JSON `schedule` shape used here is cron-only. Don't try to convert; ask how they want to handle it.

### 6. Present the diff and ask for approval

Always show the diff in chat in this exact shape, before touching the file:

```
## Drift summary: <deployment-name> (env: <env> — detected via <method>)

JSON file: <relative path from repo root>
Prefect deployment id: <uuid>

### Pipeline params
- **Modified:** <count>
  - `--max_concurrent_tasks`: `50` → `75`
  - ...
- **Added in Prefect:** <count>
  - `--new_flag=true`
  - ...
- **Removed in Prefect:** <count>
  - `--deprecated_flag=...`

### Infra
- `executors`: 18 → 24
- `driver_memory`: unchanged
- `spark_memory`: unchanged

### Schedule
- `45 6 * * *` → `30 7 * * *`

### Out-of-scope differences (informational only — will NOT be synced)
- tags: <Prefect tags> vs <JSON tags>
- ...

---
Apply these changes to <path>? (yes/no)
```

If the user says no or asks for changes (e.g. "skip the schedule change, that's intentional"), respect that and re-show the narrowed diff before applying.

If there is **no drift**, say so plainly: `No drift detected between Prefect and <path>. Nothing to sync.` Stop.

### 7. Apply the changes

Once approved:

- Use the Edit tool. For each change, target the JSON location you announced in the diff (base list, `<env>_args`, `<env>_parameters_overrides`, or top-level fields like `parameters.executors` and `schedule.value`).
- Edits to lines that aren't unique in the file (e.g. `--run_intelligence_layer=True` appears in both `staging_args` and `prod_args`) need an anchor: include the surrounding `"<env>_args": [` line in the `old_string` to disambiguate.
- Preserve the existing JSON file's formatting style (indentation, trailing newline, key ordering). The original is 2-space indented and key-ordered the way `build_deployment_configs.py` writes it. Don't reformat.
- For `pipeline_params`: keep the existing ordering of params that didn't change; insert new params at the end of the list (matching the file's existing convention); remove deleted params in place.
- After the edits, run a quick sanity check: `python -c "import json; json.load(open('<path>'))"` to make sure the file is still valid JSON. If it fails, undo and tell the user — don't try to fix bad JSON by guessing.

### 8. Tell the user what happened — and what's next

Show a short summary: which file changed, how many params/fields, and the next steps. Example:

```
Updated <path>:
  - 7 pipeline_params modified
  - 1 added, 0 removed
  - executors: 18 → 24
  - schedule unchanged

Next steps (left for you to do):
  cd <path-to>/helix.orchestration
  git checkout -b sync/<deployment-slug>
  git add <relative-path>
  git diff --cached     # final review
  git commit -m "sync(<deployment>): pull live config from Prefect <env>"
  git push -u origin sync/<deployment-slug>
  gh pr create --title "Sync <deployment> config from Prefect <env>" --body "..."
```

Keep the suggested branch name short and descriptive. Don't run any of these commands yourself — git/PR is explicitly the user's responsibility.

## Common footguns

- **Param ordering in `pipeline_params` is not stable.** Don't treat order changes as drift. Compare as a set keyed by the `--<flag>` portion before the `=`.
- **Empty-value params are a thing.** `--exclude_service_slugs=` (trailing equals, no value) is valid and not the same as the param being absent. Match on the full literal `--key=value` string when checking presence.
- **Param values can themselves contain `=`.** e.g. `--token_service_url=https://...?foo=bar`. When parsing into key/value, split on the *first* `=` only.
- **Templated values like `{token_service_client_id}` in the JSON** are placeholders that get substituted at deploy time. If you see a concrete value in Prefect (e.g. `--token_service_client_id=abc-123`) where the JSON has `{token_service_client_id}`, this is **not drift** — that's the templating system working as designed. Skip these.
- **`enable_on_demand` and `enable_driver_on_demand`** live in `*_parameters_overrides` (see `prod_parameters_overrides`, `client-sandbox_parameters_overrides` in the example). These are not in `pipeline_params`. If they differ between Prefect and the JSON, flag them in the diff but be cautious — these are env-specific overrides, not drift in the usual sense.
- **The Prefect MCP is read-only.** You cannot push back to Prefect from this skill. The direction of sync is always Prefect → code, never the reverse.
- **Multiple env overlays compound.** A param that looks "modified" might actually exist in *both* `parameters.pipeline_params` and `<env>_args` — the overlay wins at runtime, so that's the value Prefect sees. Always check all three JSON sources (base, `<env>_args`, `<env>_parameters_overrides`) before declaring drift, and follow the write-target rule in step 5a so the edit lands where it actually matters.
- **Connected env is fixed for the session.** The Prefect MCP can only point at one workspace at a time. If the user says "sync from prod" but the MCP is on staging, you can't switch — tell them and stop. Don't fake the diff against an env you're not actually connected to.
- **Don't auto-pick the file or the deployment when there's ambiguity.** Always ask. The cost of a wrong sync (silently overwriting an unrelated config) is much higher than the cost of one extra clarifying question.
- **Don't reformat the file.** Preserve indentation, key order, trailing newline. The repo's `build_deployment_configs.py` writes JSON with `indent=4`-style for new files, but existing files in the repo may use 2-space; match what's already there.
- **Don't run git commands.** Even if it would be convenient. The user has explicitly asked for git/PR to remain manual.
