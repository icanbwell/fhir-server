# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `AGENTS.md` at the repo root is the organization-wide baseline maintained by Enterprise Architecture and sets the floor for all repos. This file adds repo-specific context and may tighten those rules but must not weaken or contradict them.

## Project Overview

R4-compliant FHIR server built with Express.js, MongoDB, and an IoC container pattern. Supports REST and GraphQL APIs, Kafka event streaming, Redis caching, and OAuth 2.0 / SMART on FHIR authentication.

## Security-Sensitive Changes

Before reviewing or approving any PR that touches resource search/read, Person/Patient link
traversal (`$everything`, `$graph`, proxy-patient), resource writes (create/update/merge/patch/
remove), OAuth scope/token parsing, request-scoped caching, or any cross-resource join on a
shared identifier — read `review.md` at the repo root and adversarially review the diff against
it.

## Essential Commands

```bash
# Install dependencies (Yarn 4 with node_modules)
nvm use && corepack enable && yarn install

# Run all tests (lint + jest)
make tests

# Run a single test file
nvm use && node node_modules/.bin/jest path/to/test.js

# Run a specific test by name
nvm use && node node_modules/.bin/jest path/to/test.js -t "test name"

# Lint
make lint

# Fix lint
yarn run fix_lint

# Format code
yarn run prettier-fix

# Bring up full local stack (MongoDB, Keycloak, Redis, Kafka, ClickHouse)
make up

# Code generation (FHIR classes, GraphQL schemas, search parameters)
make generate
make graphql
make classes
make searchParameters
```

## Testing Notes

- Tests use Jest with MongoDB Memory Server (no external DB required)
- Logs are `SILENT` by default; change `LOGLEVEL` in `jest/setEnvVars.js` to `DEBUG` or `SILLY` for troubleshooting
- Tests run with `--runInBand` (serial) due to shared in-memory MongoDB
- `make tests`/`yarn test` runs the full suite in one Node process with `--max-old-space-size=20240`
  (20GB), tuned for CI/large machines since a long single-process `--runInBand` run across ~1000+
  files accumulates heap. On a memory-constrained dev machine, override with e.g.
  `JEST_MAX_OLD_SPACE_SIZE=6144 make tests` to avoid OOM/thrashing against other running apps.
- Test timeout is 60 seconds
- Custom matchers in `src/tests/customMatchers.js`: `toHaveResponse`, `toHaveMongoQuery`, etc. Use `toHaveMongoQuery` before `toHaveResponse` as it modifies the result
- Global setup/teardown: `src/tests/jestGlobalSetup.js` / `src/tests/jestGlobalTeardown.js`
- Test container overrides: `src/tests/createTestContainer.js`
- **Shared request id in integration tests.** `mockHttpContext()` pins one `systemGeneratedRequestId`
  for every request in a test, so they all share one request-scoped cache (`RequestSpecificCache`),
  including the pending-history map used by `DatabaseBulkInserter` / `FastDatabaseBulkInserter`.
  A write flushes its history in a post-request task that runs after the response is sent. If the
  test's next request starts while that task is still in flight, it works on the same map: a history
  entry is written twice (`E11000` on `<Resource>_4_0_0_History._id`, seen as a 500 on DELETE) or
  is cleared before it is written (a version missing from `_history`/vread). Real requests each get
  their own id, so this only affects tests. When a test calls `mockHttpContext()`:
  - `await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId })` after every
    write request, including between back-to-back writes in a loop, before the next write/DELETE or
    any read of history. Do this in shared helpers (e.g. `mergeResource`) rather than per call site.
  - `waitTillDoneAsync` returns as soon as the queue is empty and does not wait for a task that is
    still running if it was the last one queued (`waitTillAllRequestsDoneAsync` has the same gap).
    To assert on a post-request side effect (e.g. a history collection or document), poll for the
    condition instead of asserting right after the wait.

## Architecture

### Request Flow
Express middleware chain -> FhirRouter -> Operations -> DataLayer (MongoDB) -> Response Writers

### IoC Container
All dependency wiring is in `src/createContainer.js` (~130+ services registered in `SimpleContainer`). New classes must be registered here. For tests, override services in `src/tests/createTestContainer.js`.

### Key Entry Points
- `src/index.js` - Process entry, cluster mode, Sentry init
- `src/app.js` - Express app setup, middleware registration
- `src/server.js` - HTTP server with graceful shutdown (Terminus)
- `src/createContainer.js` - IoC container wiring
- `src/config.js` - Environment-based configuration

### Code-Generated Directories (do not edit manually)
- `src/services/` - Route handlers for each FHIR resource (from `generatorScripts/generate_services.py`)
- `src/searchParameters/` - FHIR search parameter definitions (from `generatorScripts/searchParameters/`)
- `src/graphql/` and `src/graphqlv2/` - GraphQL schemas/resolvers (from their respective generator scripts)
- `src/fhir/classes/` - FHIR resource classes

### Core Directories
- `src/operations/` - FHIR operation implementations (create, search, merge, export, history, etc.)
- `src/middleware/` - Express middleware (auth, validation, error handling, GraphQL)
- `src/dataLayer/` - Database abstraction (MongoDB bulk ops, cursors, history, attachments)
- `src/enrich/` - Resource enrichment before response (IDs, references, global IDs)
- `src/preSaveHandlers/` - Processing before database writes
- `src/queryRewriters/` - Query optimization (patient proxy, access index rewriting)
- `src/strategies/` - Passport authentication strategies
- `src/indexes/` - MongoDB index definitions; custom indexes go in `src/indexes/customIndexes.js`

### Multi-Database Architecture
- **MongoDB**: Primary store for all FHIR resources, with separate configurable connections for audit events and resource history
- **Redis**: Caching and pub/sub
- **Kafka**: Event streaming for data changes

## Code Style

- Prettier: 100 char width, semicolons, single quotes, 4-space indent, ES5 trailing commas
- Pre-commit hook runs lint
- Node >= 24.22.1 (see `.nvmrc`)
- CommonJS modules (`require`/`module.exports`)
- Logging via Winston: use `logInfo`, `logDebug`, `logError`, `logWarn` from `src/operations/common/logging.js`

## Package Management

Uses Yarn 4 with `nodeLinker: node-modules`. Dependencies are installed into a standard `node_modules/` directory. All `require()`d packages must be explicit in `package.json`.

Edit `package.json` then run `make update` to regenerate `yarn.lock`. Some packages (Sentry, OpenTelemetry) are version-locked due to compatibility issues -- test thoroughly before updating.
