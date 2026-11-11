#### □ □ ■ □

## _Checkmate - QA workflows for Claude Code_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%"/>

#

Checkmate helps Claude test a running application with the tools in its host. It stores requirements, plans, decisions, results, and evidence in one SQLite database. Each requirement maps to tests with explicit assertions. When the requirements do not give an answer, Claude records a gap for the caller to decide.

## Who uses it

- **A caller in Claude Code** uses the `/checkmate:` skills. The caller can be a human or an agent.
- **An agent or CI job** uses the CLI. `checkmate delegate` runs a stage in a fresh Claude Code session.
- **A human reviewing** opens `/checkmate:ui` or `checkmate ui`. The inbox shows gaps to answer, plans to approve, and results to accept. It updates when an agent writes.

All three use the same workspace database.

## Start in Claude Code

Use Node.js 24.12.0 or later. Install the plugin:

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Tell Claude the target URL, permitted operations, and context sources. Ask it to open a target request named `shop` and run setup. Then ask it to open a plan request named `checkout` from your requirements. The skills use those saved IDs:

```text
/checkmate:setup shop
/checkmate:plan checkout
/checkmate:ui
```

The plugin includes the database commands and review UI. You do not need to install the npm CLI to use it. Give Claude the context sources, permitted operations, and tool instructions during setup. A plan can add context or narrow the tool instructions.

Answer the gaps and approve the plan before execution. Review the results and their evidence before acceptance. [Workflow](docs/WORKFLOW.md) explains these steps and retests.

## CLI for agents and scripts

The optional npm CLI adds `delegate` and a shell command for the same database operations. This toolkit CLI release is not published yet. [Build and install it from the checkout](docs/DEVELOPMENT.md#plugin-layout), then run:

```bash
checkmate plan open checkout --target shop@1 < requirements.json
checkmate delegate plan checkout --allow Read --allow "Bash(node *)"
checkmate ui
```

Create the target profile first. After the caller resolves gaps and approves the plan, begin a run and delegate execution with the permissions its tools need. [CLI](docs/CLI.md) explains delegation, permissions, and direct decision commands.

<details>
<summary>Screenshots</summary>

From a live run on a local checkout fixture. Claude found the seeded defect: the quote total is 220 PLN, and the requirement expects 240 PLN.

<img src="docs/img/toolkit-2/inbox.jpg" alt="Inbox with gaps, a plan to approve, and a result to accept"/>
<img src="docs/img/toolkit-2/run-defect.jpg" alt="Run page with a failed assertion, its evidence, and the defect"/>

The plans and runs of that live run are in [examples](docs/examples/README.md).

</details>

## How it works

- Stages: setup, plan, revise, execute, report. Decisions record an actor and a rationale.
- Skills read current database records before each task. Chat memory and exported reports are not the source of truth.
- A test passes when all its assertions pass. `inconclusive` means the evidence cannot establish the answer.
- Durable data, including screenshots, stays in `.checkmate/checkmate.db`. A run can continue after a crash. Reports are files only when you export them.
- The UI supports plan edits, linked runs, and HTML or JSON report downloads. Print a report to save a PDF.
- `delegate` verifies the worker's result against the database.

Checkmate validates structure, relationships, and evidence records. It cannot prove that an observation is true. Claude Code owns the model, tools, authentication, and permissions.

## Docs

[Workflow](docs/WORKFLOW.md)  
[CLI](docs/CLI.md)  
[Configuration](docs/CONFIGURATION.md)  
[Evidence and outcomes](docs/EVIDENCE.md)  
[Validation](docs/VALIDATION.md)  
[Development](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
