# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

R4-compliant FHIR server built with Express.js, MongoDB, and an IoC container pattern. Supports REST and GraphQL APIs, Kafka event streaming, Redis caching, and OAuth 2.0 / SMART on FHIR authentication.

## Essential Commands

```bash
# Install dependencies (uses Yarn)
nvm use && yarn install

# Run all tests (lint + jest)
make tests

# Run a single test file
nvm use && node node_modules/.bin/jest path/to/test.js

# Run a specific test by name
nvm use && node node_modules/.bin/jest path/to/test.js -t "test name"

# Lint
make lint

# Fix lint
npm run fix_lint

# Format code
npm run prettier-fix

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
- Test timeout is 60 seconds
- Custom matchers in `src/tests/customMatchers.js`: `toHaveResponse`, `toHaveMongoQuery`, etc. Use `toHaveMongoQuery` before `toHaveResponse` as it modifies the result
- Global setup/teardown: `src/tests/jestGlobalSetup.js` / `src/tests/jestGlobalTeardown.js`
- Test container overrides: `src/tests/createTestContainer.js`

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
- Node >= 24.14.0 (see `.nvmrc`)
- CommonJS modules (`require`/`module.exports`)
- Logging via Winston: use `logInfo`, `logDebug`, `logError`, `logWarn` from `src/operations/common/logging.js`

## Package Management

Edit `package.json` then run `make update` to regenerate `yarn.lock`. Some packages (Sentry, OpenTelemetry) are version-locked due to compatibility issues -- test thoroughly before updating.
