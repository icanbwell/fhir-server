---
name: dqm-local-testing
description: Run the DQM pipeline services locally end-to-end (orchestrator :8211, bundler :8025, evaluator :8026, normalizer :8212) with changeset-aware test-plan generation, shared Kafka/Postgres/LocalStack infrastructure, and synthetic data via hp-validation-tests.
argument-hint: "<service(s)> — e.g. 'orch', 'bundler and evaluator', 'all'"
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Agent
---

# DQM Pipeline Local Testing Skill

Run the DQM pipeline services locally to test end-to-end bundling, consolidation, evaluation, and normalization flows. Includes synthetic test data creation following hp-validation-tests patterns.

## When to Use

- Testing new orchestrator/bundler/evaluator/normalizer features locally before PR merge
- Validating the full pipeline flow with synthetic data
- Debugging pipeline behavior with local log access
- Running multi-service integration tests that aren't covered by unit/integration test suites

## Invocation

When this skill is invoked, first run the **Changeset-Aware Testing** analysis below. Based on the git diff and test analysis, determine which services are needed and present the test plan for confirmation.

If no local changes are detected (clean working tree), fall back to asking the user which services to run:

1. **Orchestrator + Bundler** (bundling + consolidation only)
2. **Orchestrator + Bundler + Evaluator** (through CQL evaluation)
3. **All 4 services** (full pipeline through normalization)

Parse `$ARGUMENTS` for service hints:
- `orchestrator` / `orch` — Orchestrator only
- `bundler` / `bundle` — Bundler only
- `evaluator` / `eval` — Evaluator only
- `normalizer` / `norm` — Normalizer only
- `all` — All 4 services
- Combinations: `orch + bundler`, `bundler and evaluator`, etc.

## Service Registry

| Service | Port | Repo | Docker Deps | S3 Needed? |
|---------|------|------|-------------|------------|
| Orchestrator | 8211 | `clinical-reasoning-orchestrator-service` | Kafka, Postgres | No |
| Bundler | 8025 | `fhir-bundler-service` | LocalStack (S3) | Yes (write bundles) |
| Evaluator | 8026 | `cql-evaluator-adapter-service` | (shared Kafka only) | Yes (read bundles, write results) |
| Normalizer | 8212 | `clinical-results-normalizer-service` | LocalStack (S3) | Yes (read results, write normalized) |

## Service Architecture

```
[Orchestrator :8211] → Kafka → [Bundler :8025] → LocalStack S3
     ↑                              ↓
     ├──── bundling.events ─────────┘
     │
     ├── consolidation.commands ──→ [Bundler] → consolidation.events ──→ [Orchestrator]
     │
     ├── evaluation.commands ─────→ [Evaluator :8026] → evaluation.events ──→ [Orchestrator]
     │
     └── normalization.commands ──→ [Normalizer :8212] → normalization.events → [Orchestrator]
```

**Topics:**
- `clinical_quality.bundling.commands` — Orchestrator sends BundleData
- `clinical_quality.bundling.events` — Bundler sends DataBundled/DataBundleFailed
- `clinical_quality.consolidation.commands` — Orchestrator sends ConsolidateData; Bundler sends ConsolidateChunk
- `clinical_quality.consolidation.events` — Bundler sends DataConsolidated/ConsolidationFailed
- `clinical_quality.evaluation.commands` — Orchestrator sends EvaluateData
- `clinical_quality.evaluation.events` — Evaluator sends DataEvaluated/EvaluationFailed
- `clinical_quality.normalization.commands` — Orchestrator sends NormalizeResults
- `clinical_quality.normalization.events` — Normalizer sends ResultsNormalized/NormalizationFailed

## Changeset-Aware Testing

Every time this skill is invoked, automatically analyze the local changeset to generate targeted test scenarios. This ensures local testing exercises the specific code paths that changed, not just generic happy-path flows.

### Step 1: Analyze the changeset

Run these in parallel to understand what changed:

```bash
# What files changed (unstaged + staged + untracked)
git status
git diff --name-only
git diff --cached --name-only

# Full diff for understanding the nature of changes
git diff
git diff --cached
```

### Step 2: Analyze related tests

For each changed source file, find its corresponding tests:
- Unit tests: `src/test/java/.../<ClassName>Test.java`
- Integration tests: `src/itest/java/.../<ClassName>IT.java` or files in `src/itest/`
- Docker-compose test configs: `src/itest/resources/docker-compose-test.yml`

Read the test files to understand:
- What scenarios/edge cases are being validated
- What assertions define "correct" behavior
- What test data patterns are used (inputs, expected outputs)
- What Kafka messages or REST calls the itests exercise

### Step 3: Generate a test plan

Based on the changeset analysis, determine:
1. **Which services need to run** — only start services relevant to the changed code paths
2. **What scenarios to exercise** — derive from the code changes + test assertions
3. **What to monitor** — specific log patterns, S3 outputs, Kafka messages, or DB state that prove the change works
4. **Expected outcomes** — what success looks like for each scenario

### Step 4: Present the plan for confirmation

Before executing, present a clear summary to the developer:

```
## Local Test Plan

### Changes detected:
- [file1.java]: <brief description of what changed>
- [file2.java]: <brief description of what changed>

### Services to start:
- Orchestrator (needed because: ...)
- Bundler (needed because: ...)

### Test scenarios:
1. <Scenario name> — Tests <what>, expects <outcome>
   Why: validates <specific code path from the changeset>
2. <Scenario name> — Tests <what>, expects <outcome>
   Why: validates <specific code path from the changeset>

### What I'll monitor:
- Logs: <specific patterns>
- S3: <expected files/paths>
- DB: <expected state>

Does this look right? Should I add/remove any scenarios?
```

Wait for the developer to confirm or adjust before proceeding.

### Step 5: Execute and validate

Run the test plan:
1. Start infrastructure + services (only what's needed)
2. Execute each scenario
3. Capture evidence (log snippets, S3 file listings, curl responses, DB queries)
4. Compare actual outcomes to expected outcomes

### Step 6: Produce a validation summary

After all scenarios complete, produce a summary:

```
## Validation Summary

### Changeset: <branch-name> (<N files changed>)

### Results:
| # | Scenario | Status | Evidence |
|---|----------|--------|----------|
| 1 | <name>   | PASS   | <brief proof> |
| 2 | <name>   | FAIL   | <what went wrong> |

### What this validates:
- <Specific assertion about the PR: e.g., "Consolidation correctly merges chunks when chunk count exceeds max_chunks threshold">
- <Another assertion>

### What this does NOT validate (out of scope for local testing):
- <e.g., "Multi-partition ordering under concurrent load — requires deployed environment">
```

This summary is intended to be copy-pasteable into a PR description or Slack message as evidence of local validation.

---

## Prerequisites

- Docker Desktop running
- Java 21+ (`java -version`)
- **Source root exported** — all service repos are assumed to live under one directory. Set it once per shell (defaults to `~/src`):

  ```bash
  export DQM_SRC_ROOT="${DQM_SRC_ROOT:-$HOME/src}"
  ```

  Every command below uses `$DQM_SRC_ROOT/{repo}`. If your clones live elsewhere, export `DQM_SRC_ROOT` to that parent directory first.
- `~/kui/config.yml` file exists (can be empty — needed by Kafka UI container)
- `~/.dqm-local-env.sh` file with Cognito credentials (see Credentials section)
- Dev token accessible via the credentials in env file

## Credentials Setup

Create `~/.dqm-local-env.sh` (NEVER commit this):

```bash
#!/bin/bash
# DQM Local Testing - Environment Variables
# NEVER commit. Lives in ~ outside any git repo.

export auth_client_id="<DEV_COGNITO_CLIENT_ID>"
export auth_client_secret="<DEV_COGNITO_CLIENT_SECRET>"

# Override scope — local profiles hardcode a scope not supported by all Cognito clients
export SPRING_APPLICATION_JSON='{"auth":{"client":{"scope":"access/*.* user/*.*"}}}'
```

**Getting credentials:** The client must support `client_credentials` grant with scopes `access/*.* user/*.*`. The token URL is `https://bwell-dev.auth.us-east-1.amazoncognito.com/oauth2/token`.

## Infrastructure Setup

### Step 1: Stop conflicting containers

```bash
# Check for port conflicts
docker ps --format "{{.Names}} {{.Ports}}" | grep -E "9092|8025|8211|4566|5432"

# Stop any conflicting containers
docker stop <conflicting-container-names>
```

### Step 2: Start shared infrastructure

Use the orchestrator's docker-compose for Kafka + Postgres, and the bundler's for LocalStack.
All 4 services share one Kafka broker (localhost:9092) and one LocalStack S3 (localhost:4566).

```bash
# Start Kafka + Postgres (from orchestrator)
cd ${DQM_SRC_ROOT}/clinical-reasoning-orchestrator-service
docker compose -f docker-compose-local.yml up -d

# Start LocalStack only (from bundler — skip its Kafka to avoid port conflict)
# LocalStack auto-creates the bwell-dqm bucket via init-s3.py hook
cd ${DQM_SRC_ROOT}/fhir-bundler-service
docker compose -f docker-compose-local.yml up -d localstack
```

### Step 3: Verify infrastructure health

```bash
# Kafka (binary path varies by image — try both)
docker exec cr-orchestrator-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list 2>/dev/null \
  || docker exec cr-orchestrator-kafka kafka-topics --bootstrap-server localhost:9092 --list

# Postgres
docker exec cr-orchestrator-postgres pg_isready

# LocalStack + S3 bucket
curl -sf http://localhost:4566/_localstack/health | python3 -m json.tool
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 s3 ls
# Should show: bwell-dqm bucket (created by init-s3.py hook)
```

## Starting Services

### Step 4: Build services

Build whichever services you need to run:

```bash
# Always needed:
cd ${DQM_SRC_ROOT}/clinical-reasoning-orchestrator-service && ./gradlew compileJava
cd ${DQM_SRC_ROOT}/fhir-bundler-service && ./gradlew compileJava

# If running evaluator:
cd ${DQM_SRC_ROOT}/cql-evaluator-adapter-service && ./gradlew compileJava

# If running normalizer:
cd ${DQM_SRC_ROOT}/clinical-results-normalizer-service && ./gradlew compileJava
```

### Step 5: Start services

Start in foreground (one terminal per service):

```bash
# Terminal 1: Orchestrator
source ~/.dqm-local-env.sh
cd ${DQM_SRC_ROOT}/clinical-reasoning-orchestrator-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun

# Terminal 2: Bundler
source ~/.dqm-local-env.sh
cd ${DQM_SRC_ROOT}/fhir-bundler-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun

# Terminal 3: Evaluator (if needed)
source ~/.dqm-local-env.sh
cd ${DQM_SRC_ROOT}/cql-evaluator-adapter-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun

# Terminal 4: Normalizer (if needed)
source ~/.dqm-local-env.sh
cd ${DQM_SRC_ROOT}/clinical-results-normalizer-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun
```

Or run in background:
```bash
source ~/.dqm-local-env.sh

cd ${DQM_SRC_ROOT}/clinical-reasoning-orchestrator-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun > /tmp/orchestrator.log 2>&1 &

cd ${DQM_SRC_ROOT}/fhir-bundler-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun > /tmp/bundler.log 2>&1 &

cd ${DQM_SRC_ROOT}/cql-evaluator-adapter-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun > /tmp/evaluator.log 2>&1 &

cd ${DQM_SRC_ROOT}/clinical-results-normalizer-service
SPRING_PROFILES_ACTIVE=local AWS_CONFIG_FILE=/dev/null ./gradlew bootRun > /tmp/normalizer.log 2>&1 &
```

### Step 6: Verify services are healthy

```bash
curl -sf http://localhost:8211/actuator/health  # Orchestrator
curl -sf http://localhost:8025/actuator/health  # Bundler
curl -sf http://localhost:8026/actuator/health  # Evaluator
curl -sf http://localhost:8212/actuator/health  # Normalizer
```

## Creating Synthetic Test Data

The bundler requires the full dual-Person/Patient model (client-side + bwell-side) created through the Identity Gateway. The hp-validation-tests Karate framework automates this.

### Option A: Use hp-validation-tests directly (Recommended)

```bash
cd ${DQM_SRC_ROOT}/hp-validation-tests
git pull  # Always use latest

# Run the DQM group measure test (creates 3 persons + executes measure)
./gradlew test -Dkarate.env=dev \
  -Dclient.id=<CLIENT_ID> \
  -Dclient.secret=<CLIENT_SECRET> \
  -Dclient.key=<CLIENT_KEY> \
  -Dkarate.options="--tags @bcse-group-measure"
```

This creates:
1. 3 synthetic users via BIG + Identity Gateway (each gets Person + Patient in FHIR)
2. Level 1 resources (Organization, Practitioner, Medication, Questionnaire)
3. Level 3 patient-linked resources (Encounter, Coverage, Condition, Observation, etc.)
4. BCSE-specific resources (mammography observation, mastectomy procedure)
5. Invokes the orchestrator's `$evaluate` endpoint

### Option B: Create data manually via curl

If you need persons created but want to invoke the orchestrator locally (not against deployed services), follow these steps:

**Step 1: Get token**
```bash
TOKEN=$(curl -s -X POST "https://bwell-dev.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n '<CLIENT_ID>:<CLIENT_SECRET>' | base64)" \
  -d "grant_type=client_credentials&scope=access/*.*+user/*.*" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

**Step 2: Create users via BIG + Identity Gateway**

The bundler requires the dual Person/Patient model. This CANNOT be created by direct FHIR PUT — it must go through the Identity Gateway which creates:
- A "client" Person + Patient (representing the data source)
- A "bwell" Person + Patient (the unified b.well record)
- Proper links between them

```bash
# Generate JWE payload (use hp-validation-tests NewUserPayloadGenerator pattern)
# POST to BIG: https://big.dev.bwell.zone/api/admin/jwe/token/encrypt
# Exchange at Identity Gateway: https://bwell-identity-gateway.dev.bwell.zone/token

# The response contains: clientFhirPersonId, clientFhirPatientId, bwellFhirPersonId, bwellFhirPatientId
```

**Step 3: Create clinical resources for each patient**

After Identity Gateway creates Person+Patient, create clinical resources:
```bash
# Coverage (required for bundling)
curl -s -X POST "https://fhir.dev.bwell.zone/4_0_0/Coverage" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
  "resourceType": "Coverage",
  "meta": {"source": "https://dqm-local-test", "security": [
    {"system": "https://www.icanbwell.com/owner", "code": "<SECURITY_LABEL>"},
    {"system": "https://www.icanbwell.com/access", "code": "<SECURITY_LABEL>"},
    {"system": "https://www.icanbwell.com/sourceAssigningAuthority", "code": "<SECURITY_LABEL>"}
  ]},
  "status": "active",
  "beneficiary": {"reference": "Patient/<CLIENT_PATIENT_ID>"},
  "payor": [{"reference": "Organization/<MANAGING_ORG_ID>"}],
  "period": {"start": "2025-01-01", "end": "2025-12-31"}
}'
```

See `${DQM_SRC_ROOT}/hp-validation-tests/src/test/java/payload/dqm/` for all resource templates.

## Invoking the Orchestrator

### Clean the database (if re-running)

```bash
docker exec cr-orchestrator-postgres psql -U postgres -d orchestratordb -c \
  "DELETE FROM work_unit_person; DELETE FROM work_unit_context; DELETE FROM execution_work_unit; DELETE FROM data_source; DELETE FROM orchestrator_executions;"
```

### Quick-start: Find test persons

The dev FHIR server has real persons with non-UUID security labels (e.g., `walgreens`). To find usable person IDs:

```bash
TOKEN=$(cat /tmp/dqm-token.txt)  # or generate fresh
curl -s "https://fhir.dev.bwell.zone/4_0_0/Person?_security=walgreens&_count=3&_elements=id" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
bundle = json.loads(sys.stdin.read())
ids = [e['resource']['id'] for e in bundle.get('entry', [])]
print(','.join(ids))
"
```

Since `walgreens` is not a UUID, use a synthetic managingOrganization UUID (e.g., `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`). The `_security` label in the subject query is what drives person lookup, not managingOrganization.

### Trigger $evaluate

```bash
TOKEN=$(curl -s -X POST "https://bwell-dev.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n '<CLIENT_ID>:<CLIENT_SECRET>' | base64)" \
  -d "grant_type=client_credentials&scope=access/*.*+user/*.*" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -X POST "http://localhost:8211/fhir/4_0_0/Measure/\$evaluate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
  "resourceType": "Parameters",
  "parameter": [
    {"name": "measureId", "valueId": "<MEASURE_ID>"},
    {"name": "periodStart", "valueDate": "2025-01-01"},
    {"name": "periodEnd", "valueDate": "2025-12-31"},
    {"name": "subject", "valueString": "_security=<SECURITY_LABEL>&_elements=id&_id=<PERSON_ID_1>,<PERSON_ID_2>,<PERSON_ID_3>"},
    {"name": "parameters", "resource": {"resourceType": "Parameters", "parameter": [
      {"name": "scheduleId", "valueString": "99"},
      {"name": "outputFormatGroup", "valueString": "Standard Execution Output V2"},
      {"name": "managingOrganization", "valueString": "<MANAGING_ORG_ID>"},
      {"name": "clientFhirPersonId", "valueString": "<PERSON_ID_1>"},
      {"name": "bwellFhirPersonId", "valueString": "<PERSON_ID_1>"}
    ]}}
  ]
}' | python3 -m json.tool
```

**Key requirements:**
- Person IDs MUST be UUID format (orchestrator validates against UUID regex)
- `_security` value must be a single label (no pipes or commas — e.g., `walgreens` not `https://www.icanbwell.com/owner|walgreens`)
- `managingOrganization` MUST be a valid UUID (the `ManagingOrganization` value object enforces `UUID.fromString()`). If the org's security label is not a UUID (e.g., `walgreens`), use a synthetic UUID like `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` — the orchestrator uses this for record ownership, not for FHIR queries
- `clientFhirPersonId` and `bwellFhirPersonId` are REQUIRED parameters — omitting them causes `ExecutionMappingException`
- Persons must have proper Client Patient links (created via Identity Gateway) for the bundler to resolve data. For orchestrator-only testing (leader/follower flow), any valid FHIR Person IDs suffice

### Poll progress

```bash
EXEC_ID="<from-evaluate-response>"
curl -s "http://localhost:8211/api/v1/executions/$EXEC_ID/progress" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Expected state transitions:**
1. `POPULATING` — resolving persons from FHIR
2. `BUNDLING` — dispatching BundleData commands, waiting for bundles
3. `BUNDLED` — all persons bundled successfully
4. `CONSOLIDATED` (INE-734) — consolidation phase complete
5. `EVALUATED` — CQL evaluation complete (requires evaluator service)
6. `NORMALIZED` — normalization complete (requires normalizer service)

For testing bundling + consolidation only, the flow stops at CONSOLIDATED (no evaluator/normalizer running).

## Checking S3 (LocalStack)

```bash
# List all files in bwell-dqm bucket
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url=http://localhost:4566 s3 ls s3://bwell-dqm/ --recursive

# Files follow pattern:
# bundled/<org>/<execution-id>/<work-unit-id>/<person-id>/<resource-type>.ndjson
# consolidated/<org>/<execution-id>/<work-unit-id>/<resource-type>.ndjson
```

## Monitoring Logs

```bash
# Follow orchestrator for state transitions
tail -f /tmp/orchestrator.log | grep -E "state|BUNDL|CONSOLIDAT|EVALUAT|NORMALIZ|FAILED|transition"

# Follow bundler for bundling/consolidation activity
tail -f /tmp/bundler.log | grep -E "BundleData|Consolidat|ERROR|DataBundled|chunk"

# Follow evaluator for CQL evaluation
tail -f /tmp/evaluator.log | grep -E "EvaluateData|Evaluation|DCS|NCQA|ERROR|DataEvaluated"

# Follow normalizer for normalization
tail -f /tmp/normalizer.log | grep -E "NormalizeResults|Normalized|ERROR|MeasureReport"
```

## Teardown

### Stop services
```bash
# If running in foreground: Ctrl+C in each terminal

# If running in background:
for port in 8211 8025 8026 8212; do
  lsof -i :$port -t 2>/dev/null | xargs kill -9 2>/dev/null
done
pkill -f "GradleDaemon"
```

### Stop Docker infrastructure
```bash
cd ${DQM_SRC_ROOT}/clinical-reasoning-orchestrator-service
docker compose -f docker-compose-local.yml down

cd ${DQM_SRC_ROOT}/fhir-bundler-service
docker compose -f docker-compose-local.yml down
```

### Full cleanup (including volumes)
```bash
cd ${DQM_SRC_ROOT}/clinical-reasoning-orchestrator-service
docker compose -f docker-compose-local.yml down -v

cd ${DQM_SRC_ROOT}/fhir-bundler-service
docker compose -f docker-compose-local.yml down -v
```

### Clean up synthetic FHIR data (optional)
```bash
TOKEN=$(curl -s -X POST "https://bwell-dev.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n '<CLIENT_ID>:<CLIENT_SECRET>' | base64)" \
  -d "grant_type=client_credentials&scope=access/*.*+user/*.*" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Delete synthetic resources by source tag
for TYPE in Person Patient Coverage Observation Condition Encounter; do
  curl -s -X DELETE "https://fhir.dev.bwell.zone/4_0_0/$TYPE?_source=https://dqm-local-test" \
    -H "Authorization: Bearer $TOKEN"
done
```

## Troubleshooting

### `invalid_grant` from Cognito
The scope in `SPRING_APPLICATION_JSON` doesn't match what the Cognito client supports. Verify:
```bash
curl -s -X POST "https://bwell-dev.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n '<CLIENT_ID>:<CLIENT_SECRET>' | base64)" \
  -d "grant_type=client_credentials&scope=access/*.*+user/*.*"
```

### Execution immediately FAILED as leader
Check orchestrator logs for auth errors. The FHIR client needs valid credentials for population resolution.

### Execution created as FOLLOWER (AWAITING_GROUP_BUNDLE)
A stale leader exists in the database. Clean the DB:
```bash
docker exec cr-orchestrator-postgres psql -U postgres -d orchestratordb -c \
  "DELETE FROM work_unit_person; DELETE FROM work_unit_context; DELETE FROM execution_work_unit; DELETE FROM data_source; DELETE FROM orchestrator_executions;"
```

### `ClientPatient not found for personId`
The Person doesn't have proper Patient links via Identity Gateway. You CANNOT create persons via direct FHIR PUT for bundler testing — must use BIG + Identity Gateway (see hp-validation-tests).

### Invalid personId format
Person IDs must be UUIDs. Non-UUID IDs (like `dqm-test-person-001`) are rejected by the orchestrator's `PersonQueryParameterValidator`.

### Port already in use
```bash
lsof -i :<port> | grep LISTEN
# Kill the offending process
```

### Kafka topics not auto-created
Local Kafka uses auto-topic-creation. If topics are missing:
```bash
# binary path varies by image — try both (cp-kafka uses `kafka-topics` on PATH)
docker exec cr-orchestrator-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic clinical_quality.bundling.commands --partitions 1 --replication-factor 1 2>/dev/null \
  || docker exec cr-orchestrator-kafka kafka-topics --bootstrap-server localhost:9092 \
  --create --topic clinical_quality.bundling.commands --partitions 1 --replication-factor 1
```

## Key Configuration

| Service | Port | Profile | FHIR URL | Auth | S3 Bucket |
|---------|------|---------|----------|------|-----------|
| Orchestrator | 8211 | local | fhir.dev.bwell.zone | Dev Cognito | — |
| Bundler | 8025 | local | fhir.dev.bwell.zone | Dev Cognito | bwell-dqm |
| Evaluator | 8026 | local | fhir.dev.bwell.zone | Dev Cognito | bwell-dqm |
| Normalizer | 8212 | local | fhir.dev.bwell.zone | Dev Cognito | bwell-dqm |

| Infrastructure | Port | Source |
|----------------|------|--------|
| Kafka | 9092 | Orchestrator docker-compose |
| Kafka UI | 8080 | Orchestrator docker-compose |
| Postgres | 5432 | Orchestrator docker-compose |
| LocalStack | 4566 | Bundler docker-compose |

### Evaluator-Specific Notes

The evaluator calls the NCQA DCS external API for CQL evaluation. For local testing:
- Requires `NCQA_DCS_API_KEY` and `NCQA_DCS_URL` in env or application-local.yaml
- If these are not set, evaluations will fail with auth errors against NCQA
- The evaluator reads bundled data from S3 (written by the bundler) and writes evaluation results back to S3

### Normalizer-Specific Notes

The normalizer reads evaluation results from S3 and produces normalized MeasureReport resources:
- Reads from `resultsStorageUri` (S3 path provided in the NormalizeResults command)
- Writes normalized output to `outputStoragePrefix` in the same bucket
- The `dcs_prefer_uncompressed` flag (default: false) controls whether it prefers .ndjson over .ndjson.gz

## Related Skills
- `java-local-dev` — Single-service local dev
- `java-staging-connected` — Connecting to remote infrastructure
- `java-e2e-validation` — Full E2E testing via hp-validation-tests
