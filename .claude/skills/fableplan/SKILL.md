---
name: fableplan
description: |
    Toggle "Fable Plan Mode" for this repo, on this machine only — plan with
    Fable 5, execute with Sonnet (opusplan-style). Use when the user runs
    /fableplan, optionally with "off" to disable, or "1m" to use the
    1M-context Fable variant.
---

# Fableplan — plan with Fable 5, execute with Sonnet (opt-in, per-user)

Claude Code has a built-in `opusplan` model setting ("Opus in plan mode,
Sonnet otherwise") but no Fable equivalent. This skill recreates it by
combining `opusplan` with the `ANTHROPIC_DEFAULT_OPUS_MODEL` environment
variable override, which redirects the "opus" alias to Fable 5 — giving
Fable 5 in plan mode and Sonnet for execution, at lower cost than running
Fable continuously.

This is **opt-in only**: nothing in this repo enables it by default. Running
this skill writes to `.claude/settings.local.json` and
`.claude/fableplan-backup.json` — both gitignored and specific to this
machine. Nothing is committed, and no other user or repo config is affected.

Adapted from [bapttiste73/fableplan](https://github.com/bapttiste73/fableplan)
(MIT licensed), retargeted from the user's global `~/.claude/settings.json`
to this repo's local settings file so the effect stays scoped to this repo.

## Arguments

- *(none)* — enable fableplan locally with `claude-fable-5`
- `1m` — enable fableplan locally with `claude-fable-5[1m]` (1M context
  window; higher per-token cost, use deliberately)
- `off` — disable fableplan locally, reverting to this repo's normal model
  configuration

## Enabling (no argument, or `1m`)

1. Read `.claude/settings.local.json` (repo-relative). If it does not exist,
   create it with an empty object first.
2. If `.claude/fableplan-backup.json` does not exist, create it before changing
   settings. Record whether `"model"` exists and its current value, and whether
   `"env"."ANTHROPIC_DEFAULT_OPUS_MODEL"` exists and its current value. This
   backup represents the pre-fableplan configuration and must not be overwritten
   on subsequent enables.
3. Merge the following keys, preserving every other existing setting (notably
   `permissions` and `defaultMode`, if present):
   - Set `"model": "opusplan"`.
   - Under `"env"` (create the object if missing, preserve its other
     entries), set `"ANTHROPIC_DEFAULT_OPUS_MODEL"` to `"claude-fable-5"` (or
     `"claude-fable-5[1m]"` if the argument is `1m`).
4. Validate that both resulting files are valid JSON.
5. Tell the user:
   - Fableplan is enabled on this machine: plan mode runs on Fable 5,
     execution runs on Sonnet.
   - They must **restart their Claude Code session** for the change to take
     effect.
   - The UI will display "Opus Plan Mode" — that label is cosmetic; plan mode
     actually runs Fable 5.
   - This only changed gitignored local files — nothing is committed and no
     other user is affected.

## Disabling (`off`)

1. Read `.claude/settings.local.json`. If it does not exist, there is nothing
   to do — tell the user fableplan is already off (it was never enabled on
   this machine).
2. Read `.claude/fableplan-backup.json`. If it does not exist, do not change
   `"model"` or `"ANTHROPIC_DEFAULT_OPUS_MODEL"`: their origin cannot be
   determined safely. Tell the user that fableplan's backup is missing and its
   settings were left intact.
3. Otherwise, restore `"model"` and `"env"."ANTHROPIC_DEFAULT_OPUS_MODEL"` to
   the values recorded in the backup. Remove each key when the backup records
   that it was absent; drop the `"env"` key entirely if it becomes empty. Leave
   every other key untouched, then delete `.claude/fableplan-backup.json`.
4. Validate JSON and tell the user:
   - Fableplan is disabled on this machine; the repo's normal model
     configuration applies again.
   - They must restart their Claude Code session for the change to take
     effect.
   - Run `/fableplan` (no argument) at any time to re-enable.

## Important caveats (mention them when enabling for the first time)

- `ANTHROPIC_DEFAULT_OPUS_MODEL` is an undocumented override — a future CLI
  update could change or remove it.
- Fable 5 is not available on every plan/account. If requests fail after
  enabling, run `/fableplan off` to revert.
- Anything else that resolves the "opus" alias (e.g. fast mode) will also
  point to Fable while `opusplan` + the env override are active.
