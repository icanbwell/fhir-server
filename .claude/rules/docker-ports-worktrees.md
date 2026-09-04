---
paths:
  - "Makefile"
  - "docker-compose*.yml"
  - "pre-commit-hook"
  - ".ktc-pinned-ports*.yml"
  - "Dockerfile*"
  - ".dockerignore"
---

# Per-worktree Docker isolation and port pinning

Every worktree gets its own isolated Compose project. The Makefile derives `PROJECT_NAME`
from the checkout directory name (`ktc-$(notdir $(CURDIR))`) and passes it via
`-p $(PROJECT_NAME)` (the `$(COMPOSE)` variable) on **every** `docker compose` invocation.
Container names, networks, volumes, and built image tags are all namespaced by it.

Most services map container-port-only, so Docker assigns a free host port — `mongo`, the
Local FHIR server, `fake-cloud`. That is why `make tests` and most of `make up` /
`make ui-tests*` run concurrently across worktrees with zero coordination. `make up`
resolves the actual bound ports at the end of the run (`docker compose port fhir 3000`)
and prints the real `http://localhost:<port>` URL.

## The three exceptions

`dev`, `fake-epic`, and `keycloak` each bake a **self-referential, browser-followed OAuth
redirect target** into their own env at container-creation time:

| Service | Env var |
|---|---|
| `dev` | `UI_BASE_URL` |
| `fake-epic` | `FAKE_EPIC_PUBLIC_BASE_URL` |
| `keycloak` | `KEYCLOAK_PUBLIC_BASE_URL` → `KC_HOSTNAME` |

Docker's dynamic port assignment made that a moving target on every `make up --build`
recreate. So the `pinned-ports` target (a prerequisite of `up` / `up-all` / `up-descope`):

1. Derives `DEV_HOST_PORT` / `FAKE_EPIC_HOST_PORT` / `KEYCLOAK_HOST_PORT` from a **checksum
   of `PROJECT_NAME`** — stable per worktree, different across worktrees. Two worktrees
   collide only if their hashes coincide, and then `docker compose up` fails with its own
   clear port-already-allocated error.
2. Writes a generated `.ktc-pinned-ports.yml` Compose override pinning those three ports
   (plus `.ktc-pinned-ports-keycloak.yml`, split out because `up-descope`'s compose set has
   no keycloak service to attach an override to). Both are gitignored, regenerated every run.
3. Rewrites `UI_BASE_URL` / `FAKE_EPIC_PUBLIC_BASE_URL` / `KEYCLOAK_PUBLIC_BASE_URL` in
   `.env` to match.

`frontend/e2e` (`global-setup.ts`, `world.ts`, `auth.steps.ts`) reads the same
`.env`-provided values, falling back to the historical 5050/8080 only if unset.
`make print-keycloak-port` resolves `KEYCLOAK_HOST_PORT` standalone.

## CI must NOT use pinned ports

`docker-compose-ci.yml` / `docker-compose-ci-descope.yml` republish the actual container
ports back to fixed values (5050, 8080, Mongo 27017, `fake-cloud` 9001), because some code
historically hardcoded those and CI runs one checkout per job.

So `pinned-ports` is **gated to a no-op on `GITHUB_ACTIONS=true`**. That variable is
GitHub-Actions-specific and set automatically in every job — deliberately **not** the
generic `CI` var, which some local tooling also sets and would silently disable pinning for
local dev. Do not "simplify" this to `CI`.

## Escape hatches

- `make tests PROJECT_NAME=foo` for a specific fixed project name.
- Raw `docker compose ...` outside the Makefile has no `-p` and no `pinned-ports`, so it
  falls back to the fixed `name: kill-the-clipboard-scanner` in `docker-compose.yml` and to
  the 5050/9002/8080 defaults.

## The pre-commit hook follows the same principle

`pre-commit-hook` (installed by `make setup-pre-commit`) namespaces independently of
`PROJECT_NAME`: it derives a `WORKTREE_SLUG` from
`basename $(git rev-parse --show-toplevel)` and suffixes both the built image tag and the
`docker run --name` with it. A `pre-commit run --all-files` inside Docker takes several
minutes, so before this, any two worktrees committing within that window failed one of them
outright with "Conflict... name already in use".

The shared `pre-commit` Docker volume (pre-commit's own hook-environment cache) stays a
**single named volume across all worktrees on purpose** — it is a read-mostly build cache,
not a live process, so concurrent mounts don't collide the way a fixed container name does.

## Disk

The Colima VM has a fixed ~18G disk; repeated rebuilds fill it and fail with `no space
left on device`. Run `make reclaim` before a rebuild or when a build hits the disk wall —
it is the safe, volume-preserving reclaim. `make nuclear` also wipes volumes (your local DB).

## Build gotchas

**Keep the `.dockerignore` exclusion of `node_modules`.** Without it, a host
`frontend/node_modules` (macOS binaries) gets copied into the Linux image and breaks the
build with `Cannot find module @rollup/rollup-linux-*`.

**Cert errors are usually not a code problem.** If a Docker build, `pip install`,
`npm run build`, or `pre-commit` step fails with `CERTIFICATE_VERIFY_FAILED`,
`sh: tsc: not found`, or a `github.com` clone failure, suspect a TLS-intercepting endpoint
agent (e.g. Aikido Endpoint Protection) before suspecting the code — see
`docs/docker-tls-cert-troubleshooting.md`.
