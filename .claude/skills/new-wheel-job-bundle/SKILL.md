---
name: new-wheel-job-bundle
description: |
    Create a new Declarative Automation Bundle (formerly called
    a Databricks Asset Bundle) for a Python Wheel Job project in this
    repository
---

# Create a New Bundle for a Wheel Job

## Overview

Scaffolds a new Databricks Asset Bundle for a wheel-based Lakeflow job using
the Cookiecutter template in `template/wheel-job-bundle`. The generated project
lands in `bundle/` and includes a `databricks.yml` with
dev/staging/sandbox/prod targets, a Python package with CLI entry point,
tests, and documentation stubs.

## Prerequisites

Cookiecutter must be installed (`pip install cookiecutter`).

## Execution

Run from the repo root:

```bash
cd bundle && cookiecutter ../template/wheel-job-bundle
```

### Prompts

| # | Prompt | Default | Notes |
|---|--------|---------|-------|
| 1 | `project_name` | `bwell-project-name` | Must match `^bwell-[a-z][a-z0-9\-]*[a-z0-9]$` |
| 2 | `package` | auto-derived | `bwell.<project_name minus "bwell-" prefix, hyphens→underscores>` |
| 3 | `package_directory` | auto-derived | `bwell/<same as package suffix>` |
| 4 | `author_email` | *(none)* | B.Well email, e.g. `first.last@icanbwell.com` |
| 5 | `date` | today (ISO-8601) | Date prefix for the spec and plan filenames; override only to backdate |

### Non-Interactive (Agent)

```bash
cd bundle && cookiecutter ../template/wheel-job-bundle --no-input \
  project_name="bwell-my-new-job" \
  author_email="first.last@icanbwell.com"
```

## Validation Rules

The template's `pre_gen_project.py` hook enforces:

- **Project name**: `^bwell-[a-z][a-z0-9\-]*[a-z0-9]$` — must start with `bwell-`, lowercase alphanumeric and hyphens only, cannot end with a hyphen.
- **Package name**: `^bwell.[a-z][._a-z0-9]*[a-z0-9]$`

## Output Structure

The generated directory name strips the `bwell-databricks-` or `bwell-`
prefix from `project_name`. For example, `bwell-mongo2databricks-job`
produces `bundle/mongo2databricks-job/`.

```console
$ tree bundle/<short-name>/
bundle/<short-name>/
├── CLAUDE.md               # Per-bundle agent context (imports spec + plan)
├── databricks.yml          # Bundle config (dev/staging/sandbox/prod targets)
├── pyproject.toml          # Hatch-managed Python project
├── Makefile                # install, test, format, dev-run, etc.
├── requirements.txt        # (generated after `make install`)
├── src/bwell/<package>/
│   ├── __init__.py
│   ├── __main__.py         # CLI entry point
│   ├── _tasks.py           # Job task logic (scaffold)
│   └── py.typed
├── tests/
│   └── test_tasks.py
└── docs/
    ├── index.md
    ├── api.md
    ├── cli.md
    ├── data-flow.md
    └── superpowers/
        ├── specs/YYYY-MM-DD-<name>-design.md   # Placeholder design doc
        └── plans/YYYY-MM-DD-<name>.md          # Placeholder implementation plan
```

## Post-Scaffold Steps

1. `cd bundle/<short-name> && make install` — Create the virtual environment
    and install dependencies.
2. Fill in the design doc in `docs/superpowers/specs/`, then the dated plan in
    `docs/superpowers/plans/` — agree on the problem and the build order
    *before* implementing. These load automatically via the bundle's
    `CLAUDE.md`. See `docs/agents.md`.
3. Add job logic in `src/bwell/<package>/` — The scaffolding structure
    invokes logic using the `Task` class in `_tasks.py`, assuming that
    a `Task` instance will be used as a callable (for example: `Task()()`),
    so job logic will be kicked off by invoking the `Task.__call__` method.
    This may or may not be appropriate for the job being authored, however
    whatever the structure—the job must be callable as a CLI entry point.
4. Edit `src/bwell/<package>/__main__.py` — adjust CLI arguments if the
    defaults (`--incremental`, `--all`, `--limit`) don't fit.
5. `make format` — Apply formatting, perform linting, and validate type
    annotation.
6. `make test` — Run tests (connects to the Databricks dev workspace via
    `databricks-connect`), check linting and type annotation, and validate
    the project configurations (a local proxy for CI/CD checks).

## Common Mistakes

-   Using uppercase, underscores, or omitting the `bwell-` prefix in the project
    name — the hook will reject it.
-   Running cookiecutter from the repo root instead of from `bundle/` — the
    output lands in the wrong directory.
