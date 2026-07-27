---
name: workflow-knowledge
description: Explains GitHub Actions CI/CD workflows, pipelines, and troubleshooting for the health-data-service repository. Use when a user asks about CI/CD, deployments, releases, GitHub Actions, workflow failures, how to deploy, how to promote a tag, ephemeral environments, or why a pipeline didn't trigger.
---

# GitHub Actions Workflow Knowledge

## Contents

1. PR Merge to Dev Deployment Pipeline — the automated release chain
2. Dev to Prod Promotion Pipeline — manual promotion through environments
3. PR Checks Pipeline — what runs on every PR
4. Ephemeral Environments Pipeline — label-triggered PR environments

> **Script Jobs:** `script-job.yml` provides a `workflow_dispatch`-triggered mechanism to run ad-hoc shell commands in any environment (`dev-ue1`, `staging-ue1`, `prod-ue1`, `client-sandbox-ue1`). It uses the same `cie.gha-deploy` action with `trigger-script-job: 'true'`. Requires inputs: `script-job-name`, `script-job-command`, `env`, and `tag`.

---

## PR Merge to Dev Deployment Pipeline

When a PR is merged to `main`, an automated chain of workflows runs to create a release, build a Docker image, and deploy to the dev environment. The full chain is:

```
PR merged to main
  → release.yml (creates semver tag + GitHub Release)
    → docker-publish.yml (builds image, pushes to ECR)
      → deploy.dev-ue1.yml (pre-deployment checks + deploy)
```

Each step triggers the next via `gh workflow run`. If any step fails, the chain stops — downstream workflows won't fire.

---

### Step 1: Release (`release.yml`)

**Trigger:** `pull_request` closed on `main`  
**Condition:** PR must be merged AND must NOT have the `do-not-release` label

**What it does:**

1. Determines version bump from PR labels:
   - `Major` label → major bump (e.g., 1.0.0 → 2.0.0)
   - `Minor` label → minor bump (e.g., 1.0.0 → 1.1.0)
   - `Patch` label (or no label) → patch bump (e.g., 1.0.0 → 1.0.1)
2. Creates a git tag using `anothrNick/github-tag-action`
3. Creates a GitHub Release from that tag
4. Triggers `docker-publish.yml` with the new tag and `deployDev=true`

**Key details:**

- Requires exactly one of `Patch`, `Minor`, `Major` labels (enforced by `check_labels.yml` on the PR)
- If no version label is present, defaults to `patch`
- The `do-not-release` label skips the entire pipeline — nothing is tagged, built, or deployed

**Common failure points:**

- Release not created → PR was closed without merging, or has `do-not-release` label
- Tag already exists → manual tag was created with the same version; delete it or bump manually

---

### Step 2: Docker Publish (`docker-publish.yml`)

**Trigger:** `workflow_dispatch` (called by release.yml with `tagOverride` and `deployDev=true`)  
**Also triggered by:** GitHub Release `created` event (but in the automated pipeline, it's the `workflow_dispatch` path)

**What it does:**

1. Checks out the code at the tag ref (`refs/tags/<tag>`)
2. Authenticates to AWS ECR (region: `us-east-1`)
3. Builds Docker image with:
   - Target: `server` stage in Dockerfile
   - BuildKit secrets: `JFROG_READ_TOKEN`
   - Build args: `SENTRY_AUTH_TOKEN`, FHIR codegen credentials
4. Pushes image to: `856965016623.dkr.ecr.us-east-1.amazonaws.com/health-data-service:<tag>`
5. If `deployDev=true`: triggers `deploy.dev-ue1.yml` with the same tag

**Key details:**

- Image tag matches the git tag exactly
- Uses `DOCKER_BUILDKIT=1`
- Can be run manually via workflow_dispatch with a `tagOverride` to republish an existing tag

**Common failure points:**

- Docker build fails → usually a dependency issue (JFrog token expired, FHIR endpoint down during codegen)
- ECR push fails → AWS credentials or permissions issue
- Dev deploy not triggered → `deployDev` was not set to `true`

---

### Step 3: Dev Deployment (`deploy.dev-ue1.yml`)

**Trigger:** `workflow_dispatch` (called by docker-publish.yml)  
**Inputs:** `tag` (required), `skip_deployment_branch_checks` (optional), `use_main_branch_for_deployment_plan` (optional)

**What it does:**

#### 3a. Pre-Deployment Checks (`pre_deployment_checks.yml`)

1. **Tag/branch validation** — verifies the workflow ref matches the tag (can be skipped with `skip_deployment_branch_checks=true`)
2. **Schema check** — checks out code at the tag, generates GraphQL SDL, runs `npm run wgc-check` against Cosmo, then publishes the schema with `npm run wgc-publish`

#### 3b. Deploy (`deploy.common.yml`)

1. Checks out code at the tag (or `main` if `use_main_branch_for_deployment_plan=true`)
2. Checks out `icanbwell/cie.gha-deploy` (external deploy action)
3. Runs deployment with:
   - service-name: `health-data-service`
   - env: `dev-ue1`
   - image-tag: the release tag
   - Updates Jira with deployment info
   - Annotates ephemeral environment

**Concurrency:** Only one deployment per environment can run at a time (concurrency key: `dev-ue1`)

**Key details:**

- The deploy action lives in a separate repo (`icanbwell/cie.gha-deploy`), accessed via `BWELL_DEV_PAT`
- Schema is published to Cosmo during pre-deployment (using `COSMO_API_KEY_DEV` / `COSMO_API_URL_DEV`)
- Jira tickets are updated automatically on deploy

**Common failure points:**

- Tag validation fails → the `--ref` used in the workflow_dispatch doesn't match the tag input; use `skip_deployment_branch_checks=true` to bypass
- Schema check fails → GraphQL schema is incompatible with the federated graph in Cosmo; fix schema issues and re-release
- Deploy action fails → check `cie.gha-deploy` action logs; often infrastructure or permissions issues

---

### Pipeline Summary Table

| Stage        | Workflow File        | Triggered By                             | Produces                              |
| ------------ | -------------------- | ---------------------------------------- | ------------------------------------- |
| Release      | `release.yml`        | PR merge to main                         | Git tag + GitHub Release              |
| Docker Build | `docker-publish.yml` | release.yml via `gh workflow run`        | ECR image `health-data-service:<tag>` |
| Dev Deploy   | `deploy.dev-ue1.yml` | docker-publish.yml via `gh workflow run` | Running service in dev-ue1            |

---

### How to Re-run Parts of the Pipeline

| Scenario                                         | Action                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Release created but image not built              | Manually trigger `docker-publish.yml` with `tagOverride=<tag>` and `deployDev=true` |
| Image built but dev not deployed                 | Manually trigger `deploy.dev-ue1.yml` with `tag=<tag>`                              |
| Need to skip schema check                        | Not possible — schema check is mandatory in pre-deployment                          |
| Need to skip branch validation                   | Set `skip_deployment_branch_checks=true` when triggering deploy                     |
| Need to use main's deploy plan with an older tag | Set `use_main_branch_for_deployment_plan=true`                                      |

---

### Deployment Override Options Explained

#### `skip_deployment_branch_checks`

**What it does:** Bypasses the pre-deployment validation that the workflow's `--ref` (branch/tag the workflow was dispatched from) matches the `tag` input.

**Why it exists:** When `docker-publish.yml` triggers `deploy.dev-ue1.yml` automatically, it passes `--ref <tag>` so the ref and tag match naturally. But when you trigger a deploy _manually_ from the GitHub Actions UI, the "Use workflow from" dropdown defaults to `main` — meaning the ref is `main` while the tag input is something like `1.5.2`. This mismatch causes the validation to fail.

**When to use it:**

- You're manually triggering a deployment from the Actions UI and the "Use workflow from" field doesn't match the tag
- You need to redeploy an older tag without switching the workflow ref

**Risk:** Low — this only skips the ref/tag consistency check. The schema check and actual deployment still use the correct tag.

---

#### `use_main_branch_for_deployment_plan`

**What it does:** Makes `deploy.common.yml` check out `main` instead of `refs/tags/<tag>` when running the deploy action. The _image_ deployed is still the one tagged with the specified version — only the deployment configuration/plan files come from main.

**Why it exists:** The deploy action (`cie.gha-deploy`) reads deployment plan files (Helm charts, task definitions, config) from the checked-out code. Sometimes you need to deploy an older image but with updated infrastructure configuration that only exists on `main` (e.g., new environment variables, updated resource limits, changed health check paths).

**When to use it:**

- Infrastructure config on `main` has been updated and you need to redeploy an existing tag with the new config
- A hotfix to deployment configuration was merged to main but the service code hasn't changed (no new release needed)
- Rolling back the application version while keeping recent deployment plan changes

**Risk:** Medium — you're deploying image version X with deploy config from a potentially newer state. Ensure the deploy config on `main` is compatible with the image version you're deploying.

---

## Dev to Prod Promotion Pipeline

Promoting a release from dev through to production is a **fully manual** process. There is no automated chain — each environment is deployed independently via `workflow_dispatch`. The promotion path is:

```
dev-ue1 (automatic after PR merge)
  → staging-ue1 (manual trigger)
    → client-sandbox-ue1 (manual trigger)
      → prod-ue1 (manual trigger)
```

---

### How Promotion Works

Every environment uses the same pattern:

1. Human triggers the deploy workflow with a `tag`
2. Pre-deployment checks run (tag validation + schema check/publish to that environment's Cosmo)
3. `deploy.common.yml` deploys the image to the target environment

The **same Docker image** (built once during the PR-to-Dev pipeline) is reused across all environments. You're promoting an immutable artifact — only the deployment config and target environment change.

---

### Environment Workflows

| Environment    | Workflow File                   | Cosmo Secrets                                                   | Extra Steps                                     |
| -------------- | ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| Dev            | `deploy.dev-ue1.yml`            | `COSMO_API_KEY_DEV` / `COSMO_API_URL_DEV`                       | —                                               |
| Staging        | `deploy.staging-ue1.yml`        | `COSMO_API_KEY_STAGING` / `COSMO_API_URL_STAGING`               | Slack notification to `#bwell-staging-releases` |
| Client Sandbox | `deploy.client-sandbox-ue1.yml` | `COSMO_API_KEY_CLIENT_SANDBOX` / `COSMO_API_URL_CLIENT_SANDBOX` | —                                               |
| Prod           | `deploy.prod-ue1.yml`           | `COSMO_API_KEY_PROD` / `COSMO_API_URL_PROD`                     | —                                               |

All four workflows accept the same inputs:

- `tag` (required) — the version tag to deploy
- `skip_deployment_branch_checks` (optional, default: false)
- `use_main_branch_for_deployment_plan` (optional, default: false)

---

### Promoting a Tag: Step by Step

#### Dev → Staging

1. Confirm the tag is deployed and validated in dev
2. Go to Actions → "Staging Deployment to ue1" → Run workflow
3. Set "Use workflow from" to the tag (e.g., `1.5.2`), or use `main` and set `skip_deployment_branch_checks=true`
4. Enter the tag in the `tag` field
5. Run — pre-deployment checks will publish the schema to Cosmo staging
6. On success, a Slack message is posted to `#bwell-staging-releases`

#### Staging → Client Sandbox

1. Confirm the tag is validated in staging
2. Go to Actions → "Client Sandbox Deployment to ue1" → Run workflow
3. Same input pattern (tag + optional overrides)
4. Run — schema is published to Cosmo client-sandbox, then the image is deployed

#### Client Sandbox → Prod

1. Confirm the tag is validated in client sandbox
2. Go to Actions → "Prod Deployment to ue1" → Run workflow
3. Same input pattern (tag + optional overrides)
4. Run — schema is published to Cosmo prod, then the image is deployed

---

### Key Differences from the Dev Pipeline

| Aspect                | Dev                                     | Staging / Client Sandbox / Prod                    |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| Trigger               | Automatic (chained from docker-publish) | Manual (workflow_dispatch)                         |
| Schema publish target | Cosmo dev                               | Environment-specific Cosmo instance                |
| Notifications         | None                                    | Staging posts to Slack (`#bwell-staging-releases`) |
| Concurrency           | One deploy at a time per env            | Same — `concurrency: ${{ inputs.env }}`            |

---

### Common Failure Points

| Failure                               | Cause                                                                | Fix                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Schema check fails on staging/prod    | Schema incompatibility with that environment's federated graph       | Fix schema, re-release, redeploy to dev first, then promote up                             |
| "Branch must match tag" error         | Triggered workflow from `main` instead of the tag ref                | Re-run with `skip_deployment_branch_checks=true`, or select the tag in "Use workflow from" |
| Deploy succeeds but service unhealthy | Image works in dev but environment-specific config differs           | Check env-specific secrets, environment variables, and downstream service availability     |
| Slack notification not posted         | Only staging has Slack integration; deploy may have succeeded anyway | Check the deploy job status independently of the Slack step                                |

---

### Rollback

To roll back an environment to a previous version:

1. Identify the previous working tag (check GitHub Releases or deployment history)
2. Trigger the environment's deploy workflow with that older tag
3. Optionally set `use_main_branch_for_deployment_plan=true` if recent deploy config changes on main are needed for the rollback to work correctly

There is no dedicated rollback workflow — rolling back is just deploying an older tag.

---

## PR Checks Pipeline

When a pull request is opened (or updated) against `main`, several workflows run in parallel to validate the change before it can be merged. These are all independent — they don't trigger each other.

```
PR opened/updated against main
  ├── ci.yml (lint, build, unit-test, integration-test)
  ├── schema-check.yml (GraphQL schema compatibility)
  ├── check_commit_msg.yml (JIRA issue key format)
  └── check_labels.yml (version/release label present)
```

---

### CI/CD (`ci.yml`)

**Trigger:** `pull_request` to main (opened, synchronize, reopened), also `push` to main and `workflow_dispatch`

**Jobs and dependencies:**

```
lint (independent)
build (independent)
  ├── unit-test (needs: build)
  └── integration-test (needs: build)
```

#### Lint Job

- Node.js 22.x setup with JFrog registry
- Runs `npm run lint` and `npm run format:check`
- Catches ESLint violations and Prettier formatting issues

#### Build Job

- Builds the Docker image (same as production build) to verify it compiles
- Does NOT push to ECR — this is a validation-only build
- Uses the same build args and secrets as the production docker-publish

#### Unit Test Job (depends on: build)

- Copies `.env.example` → `.env`
- Runs FHIR code generation (`npm run generate:fhir` + `npm run generate:types`)
- Runs `npm run test:unit -- --runInBand --coverage`
- On non-PR events (push to main): also runs SonarQube scan for code quality metrics
- SonarQube quality gate is NOT enforced (commented out in workflow)

#### Integration Test Job (depends on: build)

- Same setup as unit tests
- Runs `npm run test:integration -- --runInBand`
- Uses additional secret: `CLIENT_CONFIGURATION_SECRET_KEY`

**Why tests depend on build:** The build job validates that the Docker image compiles successfully. Tests run after to avoid wasting CI time on tests if the build itself is broken.

---

### Schema Check (`schema-check.yml`)

**Trigger:** `pull_request` to main (all types)

**What it does:**

1. Installs dependencies
2. Generates GraphQL SDL files (`npm run generate:sdl`)
3. Runs `npm run wgc-check` — validates the schema is compatible with the federated graph in Cosmo

**Key details:**

- On PRs, it only **checks** — it does NOT publish the schema
- Uses dev Cosmo credentials as fallback: `secrets.COSMO_API_KEY || secrets.COSMO_API_KEY_DEV`
- Schema is only **published** during deployment (when called via `workflow_call` with `publishSchema: true`)
- Includes Docker Compose setup/cleanup (always runs cleanup even on failure)

---

### Commit Message Check (`check_commit_msg.yml`)

**Trigger:** `pull_request` to main (opened, synchronize, reopened, edited)

**What it validates:**

- PR title must match: `^(Bump|Merge|([?[A-Z]+-[0-9]+]?)):?\s+[\w\s]+`
- In practice: must start with a JIRA issue key (e.g., `PHR-1234 Add feature`) or `Bump`/`Merge`

**Exceptions:**

- Skipped entirely for `dependabot[bot]` PRs
- `Bump` prefix is allowed for dependency update PRs
- `Merge` prefix is allowed for merge commits

---

### Label Check (`check_labels.yml`)

**Trigger:** `pull_request` to main (opened, labeled, unlabeled, ready_for_review, reopened, synchronize)

**What it validates:**

- PR must have **exactly one** label from: `do-not-release`, `Patch`, `Minor`, `Major`
- Fails if zero labels or more than one of these labels is applied

**Why this matters:** The release workflow uses these labels to determine the semver bump. Without exactly one, the release pipeline won't know how to tag.

---

### PR Checks Summary

| Check             | Workflow                    | What Fails It                         | How to Fix                                                                     |
| ----------------- | --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Lint              | `ci.yml` → lint             | ESLint errors or Prettier formatting  | Run `npm run lint -- --fix` and `npm run format` locally                       |
| Build             | `ci.yml` → build            | Docker image won't compile            | Fix build errors; check if FHIR codegen dependencies are available             |
| Unit Tests        | `ci.yml` → unit-test        | Test failures                         | Run `npm run test:unit` locally to reproduce                                   |
| Integration Tests | `ci.yml` → integration-test | Test failures                         | Run `npm run test:integration` locally; may need FHIR secrets in `.env`        |
| Schema            | `schema-check.yml`          | SDL incompatible with federated graph | Run `npm run generate:sdl && npm run wgc-check` locally with Cosmo credentials |
| Commit Message    | `check_commit_msg.yml`      | Missing JIRA key in PR title          | Rename PR to `JIRA-123 Description` format                                     |
| Labels            | `check_labels.yml`          | Missing or multiple version labels    | Add exactly one of: `Patch`, `Minor`, `Major`, or `do-not-release`             |

---

### Notes

- All CI jobs run on self-hosted runners (label: `main`)
- Node.js version is 22.x across all jobs
- npm registry is JFrog (configured via `.npmrc.sample` → `.npmrc`)
- FHIR code generation is required before tests can run — tests depend on generated types
- SonarQube only runs on pushes to main (not on PRs) to avoid token exposure in fork PRs

---

## Ephemeral Environments Pipeline

Ephemeral environments are short-lived deployments tied to a specific PR. They let you test your branch in a real environment before merging. The lifecycle is fully automatic once the label is applied.

```
PR labeled with 'ephemeral-environment'
  → build-ephemeral-image.yml (build + push Docker image tagged with commit SHA)
    → deploy-ephemeral-environment (external action from icanbwell/actions)

PR closed (merged or not)
  → ephemeral-environment-cleanup.yml (destroys the environment)
```

---

### Activation

Ephemeral environments are **opt-in per PR**. To activate:

1. Add the `ephemeral-environment` label to your PR
2. The deploy workflow triggers on the next PR event (push, reopen, or add the label to an already-open PR)

Without the label, none of the ephemeral environment workflows run.

---

### Deploy (`ephemeral-environment.yml`)

**Trigger:** `pull_request` to main (opened, reopened, synchronize)  
**Condition:** PR must have the `ephemeral-environment` label

**Jobs:**

#### 1. Build Ephemeral Image (`build-ephemeral-image.yml`)

- Checks out the PR's head commit SHA (not the merge commit)
- Builds the Docker image with the same Dockerfile and build args as production
- Tags the image with the full git commit SHA: `856965016623.dkr.ecr.us-east-1.amazonaws.com/health-data-service:<commit-sha>`
- Pushes to ECR
- Outputs: `image-uri` (the full ECR URI with tag)

**Difference from production build:** The image tag is a commit SHA (not a semver tag), and it uses `BWELL_DEV_PAT` for NPM auth instead of `GITHUB_TOKEN`.

#### 2. Deploy Ephemeral Environment

- Calls the shared workflow from `icanbwell/actions` repo
- Passes: organization, repository name, PR number, and the built image URI
- The external action handles the actual infrastructure provisioning (namespace, deployment, routing)

---

### Cleanup (`ephemeral-environment-cleanup.yml`)

**Trigger:** `pull_request` to main — type `closed` (covers both merged and unmerged)

**What it does:**

- Calls `icanbwell/actions/.github/workflows/destroy-ephemeral-environment.yml`
- Passes: organization, repository name, PR number
- Destroys all infrastructure associated with that PR's ephemeral environment

**Key detail:** This runs on ALL PR closures, regardless of whether the `ephemeral-environment` label is present. The external destroy action handles the case where no environment exists (no-op).

---

### Lifecycle Summary

| Event                               | What Happens                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Label `ephemeral-environment` added | Next PR event triggers build + deploy                                              |
| New commit pushed to labeled PR     | Image rebuilt with new SHA, environment updated                                    |
| PR reopened (with label)            | Environment redeployed                                                             |
| PR closed or merged                 | Environment destroyed automatically                                                |
| Label removed (PR still open)       | No new deploys on future pushes, but existing environment stays up until PR closes |

---

### Common Failure Points

| Failure                            | Cause                                                             | Fix                                                                     |
| ---------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Environment not deploying          | Missing `ephemeral-environment` label                             | Add the label; push a commit or reopen PR to trigger                    |
| Build fails                        | Same reasons as CI build (dependency issues, FHIR endpoint down)  | Check build-ephemeral-image job logs                                    |
| Deploy fails                       | Infrastructure issue in the external `icanbwell/actions` workflow | Check the deploy-ephemeral-environment job; may need platform team help |
| Environment not cleaned up         | Cleanup workflow failed or was skipped                            | Manually trigger the destroy workflow or notify platform team           |
| Stale environment after force-push | Image was rebuilt but deploy may have used cached state           | Close and reopen PR to force a full redeploy                            |

---

### Notes

- The ephemeral image is tagged with the commit SHA, not a version — it's never promoted to other environments
- Each push to a labeled PR rebuilds and redeploys (no caching between pushes)
- The external deploy/destroy actions live in `icanbwell/actions` — this repo only controls the build step
- The cleanup is intentionally unconditional on the label — ensures no orphaned environments if the label is removed before closing
