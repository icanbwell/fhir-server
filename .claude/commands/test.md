---
description: Run specific jest tests for this repo with the correct flags
argument-hint: <test file or pattern>
---

Run `$ARGUMENTS` with jest using the repo's required flags, choosing the config by path:

- Default: `nvm use` then `node node_modules/.bin/jest $ARGUMENTS --runInBand --forceExit --no-coverage`
- Under `src/tests/unit`: add `--config jest.unit.config.js`.
- Under `src/tests/integration/atlasSearch`: add `--config jest.atlasSearch.config.js` (needs Atlas Search).
- Under `src/tests/integration/performance`: not run by this command (ignored by `jest.config.js`);
  use `yarn run test:performance` instead and say so.

Run `nvm use` as its own command, not chained with `&&`. Report pass/fail counts and the full
output of any failure.
