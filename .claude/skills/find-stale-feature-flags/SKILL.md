---
name: find-stale-feature-flags
description:
  Find stale feature flags older than N months. Use when asked to identify,
  audit, or clean up old feature flags in the codebase.
---

# Find Stale Feature Flags

Scans all `useFeatureFlagValue` and `useSearchParamFeatureFlag` usages across
`libs/` and `apps/`, then uses `git log -S` to determine when each flag string
was first introduced. Flags older than the threshold are reported as STALE.

All paths below are relative to the repo root (`ui-platform/`).

## Run

```bash
node .claude/skills/find-stale-feature-flags/find-stale-flags.mjs [months]
```

Default threshold is 6 months. Pass a number to override:

```bash
node .claude/skills/find-stale-feature-flags/find-stale-flags.mjs 3   # flags older than 3 months
node .claude/skills/find-stale-feature-flags/find-stale-flags.mjs 12  # flags older than 1 year
```

## Output

Markdown table grouped by status (STALE / OK / UNKNOWN):

| Column      | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| Flag        | The feature flag string key                              |
| First Seen  | Date the flag string first appeared in git history       |
| Age         | Days since first introduction                            |
| Location(s) | File(s) where the flag is used (first + count of others) |

## How flags are detected

The script matches three patterns:

1. **Direct usage**: `useFeatureFlagValue('flag-name', defaultValue)`
2. **Search param variant**:
   `useSearchParamFeatureFlag('flag-name', defaultValue)`
3. **Constant reference**: `const MY_FLAG = 'flag-name'` used with either hook
   above

Test files, mocks, and `node_modules` are excluded.

## After running — what to do with stale flags

For each STALE flag:

1. **Check if fully rolled out** — If the flag is enabled 100% in production,
   remove the flag check and keep only the "enabled" code path.
2. **Check if abandoned** — If the feature was never shipped, remove both code
   paths and the flag.
3. **Still needed?** — Some flags gate features per-client. Document why in a
   comment if it must stay.

To remove a flag, search for all its usages:

```bash
grep -rn "flag-name-here" libs/ apps/ --include="*.ts" --include="*.tsx"
```

## Gotchas

- **Git history depth**: Uses `git log -S` (pickaxe) which searches the full
  local history. If the repo was shallow-cloned, dates may be inaccurate.
- **Renamed flags**: If a flag was renamed, the script sees the new name's
  introduction date, not the original concept's age.
- **Runtime-only flags**: Flags checked via the SDK at runtime (not hardcoded in
  source) won't be detected. This only finds flags referenced in TypeScript.
- **Execution time**: ~2-5 minutes depending on number of flags (each requires a
  git log traversal).
