---
paths:
  - "src/**"
---

# File and folder naming

- New `.js` files and new folders under `src/` use camelCase (`kafkaClientV2.js`, `preSaveHandlers/`,
  `manageKafkaV2Topic.js`), never snake_case or kebab-case. Classes keep the file name of the class
  in camelCase.
- A test uses the name of the file it covers plus `.test.js`, in the matching folder under
  `src/tests/unit` or `src/tests/integration`.
- Do not rename existing files to fit this rule, and keep the names a generator produces
  (`src/services`, `src/searchParameters`, `src/graphql*`, `src/fhir/classes`, `src/fhir/serializers`).
  The MCP tool files (`src/mcp/tools/*.tool.js`) are an existing exception; follow their pattern
  there.
- Put code in the folder for its role: `src/operations`, `src/dataLayer`, `src/middleware`,
  `src/utils`, and so on (see "Core Directories" in `CLAUDE.md`). Operational scripts run by hand or as
  an admin job go in `src/admin/scripts/`, not a top-level `src/scripts/`; run them from the repo root
  as `node src/admin/scripts/<name>.js`, and use that path in usage text and docs.
- Relative `require` paths follow the folder depth: a file in `src/admin/scripts/` reaches `utils`
  with `../../utils/...`.
