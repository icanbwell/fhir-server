---
description: Run specific jest tests for this repo with the correct flags
argument-hint: <test file or pattern>
---

Run `$ARGUMENTS` with jest using the repo's required flags:

- Integration/default config: `nvm use && node node_modules/.bin/jest $ARGUMENTS --runInBand --forceExit --no-coverage`
- If the path is under `src/tests/unit`, add `--config jest.unit.config.js`.

Report pass/fail counts and the full output of any failure.
