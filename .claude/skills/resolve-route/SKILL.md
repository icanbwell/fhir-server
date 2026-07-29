---
name: resolve-route
description:
  Resolves between ui-platform URL paths and React components in both
  directions. Use this skill when the user asks "what component renders at this
  URL?", "which component is at this path?", "what's rendered here?", provides a
  localhost:4200 URL, wants to trace a route to its source code, OR asks "where
  is this component rendered?", "what URL uses this component?", "what route
  maps to this?", or asks about unreachable/dead components. This skill depends
  on having route config from Client Hub — invoke the client-hub skill first if
  no cached route config exists.
---

# Resolve Route

Maps between ui-platform URL paths and React components in both directions:

- **Forward**: URL → component (what renders at this route?) — instant
- **Reverse**: component → URL (where is this component rendered?) — instant
- **Trace**: component → full parent chain via TypeScript references (~8s)

## STOP — Config Dependency Check

**Before doing ANYTHING else, check if the route config cache exists AND is
fresh:**

```bash
find ~/.claude/skills/client-hub/.cache -name "config-*-*-embeddable_configuration.json" -mmin -10 2>/dev/null
```

**If NO file is returned** (either missing or older than 10 minutes):

1. You MUST invoke the `client-hub` skill using the Skill tool NOW.
2. When invoking, specify: config type = `Client Config`, module =
   `embeddable configuration`.
3. Do NOT explore the repo. Do NOT search for route files. Do NOT proceed
   without the config.
4. Wait for the skill to complete and confirm the cache file exists before
   continuing.

**If a fresh cache file exists** (returned by the find command), proceed to
Step 1.

---

## NEVER write inline scripts to parse route data. ALWAYS use `resolve_route.mjs` below.

---

## Determine Repo Root

All commands require `--repo-root`. Set it to the ui-platform checkout path:

```bash
REPO_ROOT="/path/to/ui-platform"  # adjust to actual path in the current working directory
```

If working from a ticket directory or worktree outside the repo, you MUST pass
`--repo-root` explicitly.

---

## Step 1: Determine Direction

- If the user provides a **URL or path** → use **Forward Resolution** (Step 2)
- If the user provides a **component name, file path, or registry key** → use
  **Reverse Resolution** (Step 3)

---

## Step 2: Forward Resolution (URL → Component)

```bash
node ~/.claude/skills/resolve-route/scripts/resolve_route.mjs \
  --repo-root "$REPO_ROOT" --path "<URL_PATH>"
```

Or with a full URL:

```bash
node ~/.claude/skills/resolve-route/scripts/resolve_route.mjs \
  --repo-root "$REPO_ROOT" --url "http://localhost:4200/#/health-circle/share-data"
```

Optional flags:

- `--env dev|staging|client-sandbox|prod` — use a specific env's cached config
- `--client-slug <slug>` — use a specific client's cached config
- `--list-routes` — show all available routes and their registry keys
- `--verbose` — show full matched node JSON

The script outputs:

- **Registry Key** — the `elementId` used in `mainRegistry.tsx`
- **Route Trail** — the full path of matched nodes from root to the target
- **Related registry keys** — other components from the same MFE package

---

## Step 3: Reverse Resolution (Component → URL)

### 3a: Direct lookup

```bash
node ~/.claude/skills/resolve-route/scripts/resolve_route.mjs \
  --repo-root "$REPO_ROOT" --component <QUERY>
```

Input formats: component export name, registry key, or file path.

**Exit code 0 + URL(s) found** → done. Report the result.

**Exit code 1 + "NOT IN ROUTE CONFIG"** → go to Step 3b.

**Exit code 1 + "No registry entry found"** → **IMMEDIATELY** go to Step 3c. Do
not try other approaches.

### 3b: Registered but not routed

The component has a registry key in `mainRegistry.tsx` but no corresponding
`elementId` in the client's `routeDefinition`. This means either:

- The route exists in a different client/env
- The route is genuinely unreachable (dead code)

List available cached environments and try each:

```bash
ls ~/.claude/skills/client-hub/.cache/config-*-embeddable_configuration.json 2>/dev/null
```

For each config file found (extract env from filename
`config-<ENV>-<SLUG>-...`):

```bash
node ~/.claude/skills/resolve-route/scripts/resolve_route.mjs \
  --repo-root "$REPO_ROOT" --component <QUERY> --env <ENV> --client-slug <SLUG>
```

If still "NOT IN ROUTE CONFIG" across all available cached envs → report as
**UNREACHABLE**.

### 3c: Not in registry — trace the import chain

**This is the primary resolution method for nested components.** Use it
immediately when `--component` says "No registry entry found". Do NOT try to
manually grep or explore — the trace does everything.

```bash
node ~/.claude/skills/resolve-route/scripts/resolve_route.mjs \
  --repo-root "$REPO_ROOT" --trace <ComponentName> --mfe <mfe-name>
```

Or if you have the file path:

```bash
node ~/.claude/skills/resolve-route/scripts/resolve_route.mjs \
  --repo-root "$REPO_ROOT" --file <path/to/Component.tsx>
```

The `--file` flag auto-infers component name and MFE from the path. Use it when
the user references a specific file.

**Key points:**

- Takes ~8s (loads TypeScript project). Outputs JSON with the **complete**
  reference chain in one call.
- Exit code 0 = resolved to a registry key. Exit code 1 = unreachable.
- **The script automatically checks the route config** and appends `Route:`
  lines — no separate `--component` call needed.
- If the component has **multiple parents leading to different registry keys**,
  all paths are shown under `alternatePaths` in the JSON output.

Read the JSON output:

- `resolved.registryKey` — the registry key(s) at the top of the primary chain
- `resolved.component` — the registered screen component
- `chain` — each hop from the queried component up to the registered screen
- `alternatePaths` — other registered parents found along the way (if any)

**You do NOT need a separate `--component` call after trace.** The route check
is included in the output.

### 3d: Report result

Format the final report to the user:

```
Component: <original query>
Import chain: <PricingItem → PricingPanelView → PricingPanel → DetailsContainer → DetailsPage>
Registry Key: <medicineDetails> (or NONE if chain never reached registry)
URL: <http://localhost:4200/#/path> (or UNREACHABLE — not in routeDefinition for <client>/<env>)
```

---

## Flags Reference

| Flag                   | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `--repo-root <path>`   | Explicit ui-platform repo root (bypasses auto-detection)  |
| `--path <url-path>`    | Forward: resolve URL path to component                    |
| `--url <full-url>`     | Forward: resolve full URL (extracts hash fragment)        |
| `--component <query>`  | Reverse: component name, registry key, or file path → URL |
| `--trace <name>`       | Trace: full ts-morph reference chain (~8s)                |
| `--file <path>`        | Trace from file: infers component name + MFE, then traces |
| `--mfe <mfe-name>`     | Narrow trace to specific MFE (e.g., `mfe-medicine`)       |
| `--depth <n>`          | Max trace depth (default: 5)                              |
| `--env <env>`          | Use specific environment's cached config                  |
| `--client-slug <slug>` | Use specific client's cached config                       |
| `--list-routes`        | List all available routes                                 |
| `--verbose`            | Show full matched node JSON                               |

## Exit Codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | Found / resolved successfully                       |
| 1    | Not found / unreachable                             |
| 2    | Usage error (missing args, no config, no repo root) |

## Setup

The script requires `ts-morph` for `--trace` mode. One-time install:

```bash
npm install --prefix ~/.claude/skills/resolve-route
```

If not installed, `--trace` will fail with an import error. The `--path`,
`--component`, and `--list-routes` modes work without it (they only need the
cached config JSON).
