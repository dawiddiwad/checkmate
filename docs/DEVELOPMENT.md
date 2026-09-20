# Developing Checkmate

## [HumanLayer](https://humanlayer.dev) gives each task its own agentic workspace

It supports CRISPY, RPI, PRD, and freeform workflows where humans and agents follow a structured, interactive, and guided process.

When you start a task, the [workspace config](../.humanlayer/workspace.json):

1. Creates a separate git worktree and branch for the task.
2. Runs `npm install`.
3. Copies local environment and agent settings into the worktree, without committing them.

This lets you work on several tasks without their edits colliding. Change the paths,
setup command, or copied files in the config above.

<summary>Preview</summary>
<img src="img/hl-task.png" alt="HumanLayer task workspace" width="100%"/>
<img src="img/hl-review.png" alt="HumanLayer review" width="100%"/>

## [Super Simple Software Factory](../.claude/skills/sssf) runs an alternative, less human-intensive agent workflow

It runs agents through steps such as
planning, coding, testing, and review. Each run is recorded so you can follow its progress.

You'll need [`uv`](https://docs.astral.sh/uv/), [`just`](https://github.com/casey/just), and
`sqlite3`. The visualizer also needs [`bun`](https://bun.sh/).

```bash
just demo              # try two read-only runs
just prompt "..."      # one agent, one prompt
just scout "..."       # explore without editing
just plan "..."        # plan only
just plan-build "..."  # plan, build, commit
just sdlc "..."        # plan, build, test, commit
just simple-sdlc "..." # plan, build, test, review, document
```

Run `just` to list all recipes.

### Follow a run

```bash
just sessions         # last 10 runs
just phases <adw_id>  # status of each phase
just tail <adw_id>    # recent events
just procs <adw_id>   # active processes
just obs              # visualizer at http://localhost:4601
```

<summary>Preview</summary>
<img src="img/sssf-observe.png" alt="sssf live run overview" width="100%"/>
<img src="img/sssf-audit.png" alt="sssf run audit" width="100%"/>

### Customize a workflow

- **Agents, models, and permissions:** [`sssf.config.yaml`](../adws/adw_sssf_config/sssf.config.yaml).
- **Workflow steps:** `adws/adw_*.py`; each script lists its phases at the top.
- **Prompts:** `adws/adw_data/`.

To use another roster for one run:

```bash
SSSF_CONFIG=other.yaml just sdlc "..."
```

For new workflows or deeper changes, ask your coding agent to use the `sssf` skill.
See its [cookbooks](../.claude/skills/sssf/cookbooks) for details.

## Run the checks manually

```bash
npm run phase:verify           # full local check
npm run phase:verify -- --live # also run live Ollama acceptance
```

The local check covers types, lint, formatting, tests, a clean build, exact package contents, browser-free static imports, and installed CLI behavior. Its unconditional Stagehand acceptance uses a real local form and scripted loopback provider: no live model credentials are needed. It checks observation/action/extraction/metadata callbacks, real form mutation, recovery from unsuccessful actions, state and usage across ordered steps, diagnostics allowed/discard modes, transcript-only evidence, durable terminal bytes, nested failure after earlier usage, budget exhaustion, interruption, and browser process exit. Test-only instrumentation records actual extension exports and browser netlog URLs and verifies receiver closure; these temporary audit files are not product evidence.

Use Node `>=22.18.0` and provision an extension-compatible Chrome/Chromium first. Stagehand discovers `CHROME_PATH`, then platform installations/PATH; Checkmate does not download a browser. CI selects Node `22.18.0` and Chrome for Testing `153.0.8010.52`, passing the provisioned executable through `CHROME_PATH`. Browser tests verify the actual bundled extension, not just executable presence. The old Playwright installer is removed.

For live checks, set `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` in the repo-root `.env`. The selected endpoint/model must support strict JSON-schema responses. Missing values fail the check; secrets are never printed. The live workflow exercises all five tools: discover and submit a loopback form, extract the persisted state in a second step, then navigate to the Ollama model page and extract its name/variant. It also verifies transcript references, terminal durability, local telemetry routing, and receiver/browser cleanup against the same installed tarball. CI is configured to run the live gate on **Linux and macOS**; release verification needs actual success on both, not just local macOS results. Windows is unsupported in v1.

`src/test/drivers/web/telemetry.integration.test.ts` captures actual browser exports across initialization, operations, errors, and shutdown. It proves OTLP routes only to the authenticated loopback receiver in both buffering and discard modes. This does not claim Chrome makes no unrelated background network requests. Trace delivery is asynchronous, so assertions poll with bounded deadlines rather than assuming an operation flushes telemetry.

<summary>Checking a specific package</summary>

```bash
npm run test:package:final -- <candidate.tgz> --live
```

This checks installed exports, deterministic real-browser CLI behavior, and live Ollama acceptance against the same tarball. The full `phase:verify -- --live` gate also checks its contents and build lifecycle.
For a standalone live run, `npm run test:e2e:ollama` builds its own candidate.
