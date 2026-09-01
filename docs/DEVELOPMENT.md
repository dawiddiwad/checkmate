# Developing **_checkmate_**

This page is for people working on the **_checkmate_** repo itself, not for consumers of the
`@xoxoai/checkmate` package. It covers two dev-only tools stamped into this repo to make that
work faster: the **sssf** agent pipeline factory and a **HumanLayer** workspace integration.
Neither ships in the published package, and neither is required to use `ai.step` in your own
suite.

## Table of Contents

- [sssf — the agent pipeline factory](#sssf--the-agent-pipeline-factory)
- [HumanLayer — isolated task workspaces](#humanlayer--isolated-task-workspaces)

## sssf — the agent pipeline factory

[sssf](../.claude/skills/sssf) ("Super Simple Software Factory") runs repeatable, gated AI
coding workflows against this repo: deterministic Python scripts (ADWs, "AI Developer
Workflows") own sequencing, retries, and acceptance checks, while a coding agent does the actual
reading/planning/editing inside each bounded phase. Every run is traced to SQLite so you can
watch it live or review it after the fact.

It lives in two places:

- `.claude/skills/sssf/` - the installable Claude Code skill (cookbooks, install script, agent
  and prompt templates, a small visualizer app).
- `adws/` - the factory as installed in this repo: the runnable ADW scripts, the shared
  `adw_modules/` logic, the agent roster (`adws/adw_sssf_config/sssf.config.yaml`), and prompt
  templates (`adws/adw_data/`).

### Prerequisites

- [`uv`](https://docs.astral.sh/uv/) to run the Python ADW scripts.
- [`just`](https://github.com/casey/just) to run the recipes below (`justfile` at the repo root).
- `sqlite3` to query the trace database.
- [`bun`](https://bun.sh/) only if you want the visualizer UI.

### Running a workflow

All commands are `just` recipes; run `just` with no arguments to list them.

```bash
just demo              # two cheap, read-only runs that prove the whole path works
just prompt "..."      # one agent, one prompt
just scout "..."       # read-only recon, changes nothing
just plan "..."        # plan only
just plan-build "..."  # plan, build, commit
just sdlc "..."        # plan, build, test, commit
just simple-sdlc "..." # plan, build, test, review, document
```

Each of these is a chain of phases defined in a top-level `adws/adw_*.py` script; read a
script's `Phases:` docstring to see what it runs and in what order.

### Watching a run

```bash
just sessions          # the last 10 runs
just phases <adw_id>   # phase-by-phase status for one run
just tail <adw_id>     # the live event tail
just procs <adw_id>    # what that run has alive right now, with pids
just obs                # boot the trace UI at http://localhost:4601
```

<img src="img/sssf-observe.png" alt="sssf-observe" width="100%"/>
<img src="img/sssf-audit.png" alt="sssf-audit" width="100%"/>

### Configuring the agent roster

`adws/adw_sssf_config/sssf.config.yaml` defines which agents exist, what model and thinking
effort each uses, which tools it may call, and which paths it's allowed to write to
(`writes:`) versus which are off-limits to everyone (`protected_files:`). Swap the whole roster
for one run with `SSSF_CONFIG=other.yaml just sdlc "..."`.

For anything beyond running the existing recipes - adding a new ADW, retuning an agent, or
extending `adw_modules/` - ask Claude Code to use the `sssf` skill (`/sssf install` is also how
this scaffolding got here in the first place); it routes you to the right cookbook under
`.claude/skills/sssf/cookbooks/`.

## HumanLayer — isolated task workspaces

[`.humanlayer/workspace.json`](../.humanlayer/workspace.json) configures
[HumanLayer](https://humanlayer.dev)'s workspace tooling to spin up a disposable git worktree
per task instead of working directly on your main checkout:

```json
{
	"pathTemplate": "~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
	"branchTemplate": "{{ TASKSLUG }}",
	"repos": [
		{
			"localPath": ".",
			"setupCommand": "npm install",
			"copyGlobs": [".env*", ".claude/settings.local.json", "CLAUDE.local.md", ".humanlayer/workspace.local.json"]
		}
	]
}
```

<img src="img/hl-task.png" alt="humanlayer-task" width="100%"/>
<img src="img/hl-review.png" alt="humanlayer-review" width="100%"/>

When you start a new task in HumanLayer, it uses this config to:

1. Create a new worktree at `pathTemplate`, on a new branch named from `branchTemplate`.
2. Run `setupCommand` (`npm install`) in it.
3. Copy the files matched by `copyGlobs` from your main checkout into the new worktree, so local,
   untracked things like `.env`, `.claude/settings.local.json`, and `CLAUDE.local.md` carry over
   without being committed.

This keeps concurrent tasks (including sssf runs) from stepping on each other's working tree,
and is how the checkmate development environment itself is normally set up. It only takes
effect if you're using HumanLayer; nothing in the published package depends on it.
