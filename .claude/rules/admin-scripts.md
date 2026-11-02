---
paths:
  - "src/admin/**"
  - "src/tests/**/scripts/**"
---

# Admin scripts

- Operational scripts that are run by hand or as an admin job live in `src/admin/scripts/`, not in a
  top-level `src/scripts/`.
- Name the `.js` file in camelCase after what it does (`manageKafkaV2Topic.js`,
  `migrateAuditEventsToKafkaClickPipes.js`), never snake_case or kebab-case. Its tests use the same
  name with `.test.js` (`src/tests/unit/scripts/`, `src/tests/integration/scripts/`).
- Relative requires from a script in `src/admin/scripts/` start with `../../` (for example
  `../../utils/configManager`).
- Run it by path from the repo root: `node src/admin/scripts/<name>.js`. Use that path in usage text and
  docs.
