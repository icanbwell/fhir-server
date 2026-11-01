---
description: Adversarially review the current diff against review.md
---

Read `review.md` at the repo root, then review `git diff main...HEAD` (and uncommitted changes)
against each applicable section. Report only concrete findings with file:line, the failing
scenario, and a suggested fix. State explicitly which areas (tenancy, PHI, scopes, caching) you
could not confirm.
