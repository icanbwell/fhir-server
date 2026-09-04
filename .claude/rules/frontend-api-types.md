---
paths:
  - "frontend/src/api/**/*.ts"
---

# API layer: prefer types derived from the backend schema

`frontend/src/api/schema.d.ts` is **generated** by `openapi-typescript` from `openapi.json`
at the repo root — itself a committed, generated artifact exported from `app.openapi()`.
`schema-types.ts` re-exports stable aliases over it, so a request-shape drift (snake_case,
renamed field, enum mismatch) surfaces as a **compile error at the call site** instead of a
422 at runtime.

## Regenerating

```bash
make openapi.json         # backend changed → re-export the document
make frontend-gen-types   # then regenerate schema.d.ts from it
```

`tests/test_openapi_contract.py` fails if the committed `openapi.json` no longer matches the
app, so a stale document is a red build rather than silent drift. Nothing enforces that
`schema.d.ts` was regenerated afterwards — run the second command whenever the first one
produces a diff.

Because the generator reads a file, it needs no running stack and works from any worktree.

## Current state — read before adding types

Only `destination.ts` consumes the generated types today (via `schema-types.ts`). The
other API modules — `scan.ts`, `patientChart.ts`, `epicSmartLaunch.ts`, `dashboard.ts`,
`files.ts`, `registration.ts`, `uiConfig.ts` — declare their request/response shapes
**by hand**, with no link to the backend. A backend response-model change does not break
them; it surfaces later as a failing Cucumber E2E scenario, or not at all.

**When you touch one of those modules, prefer migrating its types to
`components["schemas"][...]` over editing the hand-written copy.** Migrate the module you
are already in; don't do a repo-wide sweep as a side quest.

## Two traps

- **`openapi-typescript` is deliberately NOT a devDependency.** It requires
  `typescript@^5`, and this frontend builds on `typescript@7` — one hoisted copy can't be
  both, and forcing the root version into it (what an `overrides` entry used to do) leaves
  the CLI importing a `ts` whose `ts.factory` is `undefined`, so it crashes on startup.
  `gen:types` therefore runs it through `npx -y -p openapi-typescript@<v> -p
  typescript@<v>`, pinned in the script. Bump those pins there; don't reintroduce the
  package as a dependency.
- **`openapi-typescript` marks any field with a Pydantic `default=...` as *required*** in
  the generated type, even though it is optional on the wire. Where the frontend
  legitimately omits such a field, relax it in `schema-types.ts` with
  `Pick`/`Partial`/`Omit` — see `CreateDestinationRequest` for the pattern. Do not relax it
  by casting at the call site.

## Conventions

- All requests go through `client.ts` (Bearer-token injection). Don't call `fetch`
  directly from a page or component.
- Backend payloads are **snake_case**. Don't camelCase them in the type and then translate
  at the boundary unless the module already does so consistently.
- Keep the hand-written aliases in `schema-types.ts`, not scattered per module — one place
  to look when the backend contract moves.
