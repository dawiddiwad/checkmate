#### □ □ ■ □

## _Checkmate - QA workflows for Claude Code_

<img src="docs/img/onboarding.gif" alt="onboarding" width="50%"/>

#

Checkmate is a Claude Code plugin and a CLI. Claude tests a running application with real tools, such as a browser or HTTP. Checkmate stores the plan, the decisions, and the results, and checks that they are consistent. Each requirement maps to tests with explicit assertions. Each assertion result needs saved evidence. A question that the requirements do not answer becomes a gap, and a person decides it.

## Who uses it

- **An agent or CI job** runs `checkmate delegate`. Each stage runs in a new Claude Code session.
- **A person in Claude Code** runs the `/checkmate:` skills.
- **A person reviewing** runs `checkmate ui`. The inbox lists the gaps to answer, the plans to approve, and the results to accept. It updates when an agent writes.

You can use one of these or all of them on the same workspace.

## Install

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

```bash
npm i -g @xoxoai/checkmate
```

Use Node.js 24.12.0 or later. The npm CLI contains the plugin and adds `delegate` and `ui`.

## Usage

```bash
checkmate plan open checkout --target shop@1 < requirements.json
checkmate delegate plan checkout --allow Read --allow Write --allow "Bash(node *)"
checkmate ui
```

Claude writes the plan. Unclear requirements become gaps in the inbox. After a person answers them and approves the plan, run it:

```bash
checkmate run begin run-7 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-7 --allow Read --allow Write --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
```

The result goes to the inbox for acceptance. [Workflow](docs/WORKFLOW.md) has every step, from target setup to a retest.

<details>
<summary>Screenshots</summary>

From a live run on a local checkout fixture. Claude found the seeded defect: the quote total is 220 PLN, and the requirement expects 240 PLN.

<img src="docs/img/toolkit-2/inbox.jpg" alt="Inbox with gaps, a plan to approve, and a result to accept"/>
<img src="docs/img/toolkit-2/run-defect.jpg" alt="Run page with a failed assertion, its evidence, and the defect"/>

The plans and runs of that live run are in [examples](docs/examples/README.md).

</details>

## How it works

- Stages: setup, plan, revise, execute, report. Gap answers, plan approvals, and result acceptance are records with an actor and a rationale.
- A test passes only when all its assertions pass. `inconclusive` means that the evidence cannot show the answer.
- Everything is in `.checkmate/checkmate.db`. Saved rows do not change. A run can continue after a crash.
- `delegate` reads the result from the database. It does not use the worker's summary.

Checkmate checks structure, relationships, and evidence files. It cannot prove that an observation is true. Claude Code owns the model, tools, and permissions.

## Docs

[Workflow](docs/WORKFLOW.md)  
[CLI](docs/CLI.md)  
[Configuration](docs/CONFIGURATION.md)  
[Evidence and outcomes](docs/EVIDENCE.md)  
[Validation](docs/VALIDATION.md)  
[Dev](docs/DEVELOPMENT.md)

## License

[MIT](LICENSE)
