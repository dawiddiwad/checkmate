# Same-session rules

Read this file only in the same session as the oracle. A delegated stage or a sub-agent does not read it.

## Read the current state first

Before you answer a question about targets, plans, tests, gaps, runs, or results, read the current state from the database. Chat memory can be out of date. Another session, the review UI, or the oracle can change the database at any time.

| Question                                 | Command                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| What waits for the oracle?               | `checkmate inbox`                                           |
| Which targets and instances exist?       | `checkmate target list`, `checkmate target instance list`   |
| Where is a plan in the loop? Who acts?   | `checkmate status <planId>`                                 |
| Which plans exist, and what blocks them? | `checkmate plan list`                                       |
| What is in a plan revision?              | `checkmate plan show <planId@rev>`                          |
| Which runs exist?                        | `checkmate run list [--plan <planId>]`                      |
| What did an exploration find?            | `checkmate explore show <explorationId>`                    |
| What did a run record?                   | `checkmate run show <runId>`                                |
| Why did the oracle reject a plan or run? | `checkmate status <planId>`, `checkmate run show <runId>`   |
| What changed, and who changed it?        | `checkmate log [--subject plan:<planId>\|run:<runId>]`      |
| Anything else                            | `checkmate query "<sql>"` (read-only, SQLite `SELECT` only) |

## Who runs a stage

| Mode                              | How it starts                                                                      | Writes with                                      | Asks the oracle?                         |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Same session                      | The oracle runs `/checkmate:<stage>` in Claude Code.                               | The plugin CLI                                   | Yes. Show results and questions.         |
| Sub-agent in the same Claude host | A parent agent gives a stage to a sub-agent that has the Checkmate plugin.         | The plugin CLI                                   | No. Return the response object.          |
| Delegated session                 | `checkmate delegate <stage> <subject>` starts `claude -p` with the bundled plugin. | The plugin CLI, `CHECKMATE_ACTOR=claude:<stage>` | No. Return the response object.          |
| External agent or script          | The agent runs the npm `checkmate` command.                                        | The npm CLI                                      | It is the oracle, or it asks the oracle. |

- Oracle decisions are `gap answer`, `plan adopt-gaps`, `plan approve`, `plan reject`, `plan edit`, `result accept`, `result reject`, `claim accept`, and `claim reject`. Run them only when the oracle tells you the decision in this session. Keep the default actor, or give the oracle's name with `--actor`.
- Commands use `--actor`, then `CHECKMATE_ACTOR`, then the git user name, then the login name.

## Record a request

When `target request`, `plan request`, or `run show` refuses with `Unknown ...`, record the subject from the oracle's message.

- Setup:

  ```sh
  checkmate target open <targetId> --entry-point "web:url:Storefront." --capabilities browser,http \
    --operations read_catalog,create_fixture_order --tool "playwright-cli:cli:Drive the browser."
  ```

  Give `--entry-point <name>:<url|command|value>:<purpose>` once for each entry point. Give `--tool` once for each tool that the oracle names. Ask the oracle for a missing entry point, capability, or operation. Do not invent operations.

- Plan: run `checkmate target show <targetId>` for the latest target revision. Then record the request. Give the ticket and the product documentation as sources:

  ```sh
  checkmate plan open <planId> --target <targetId@rev> --objective "<from the oracle>" --source jira:SHOP-12 --source docs/checkout.md
  ```

  To give requirements or tools, send the full request in a heredoc in place of the flags:

  ```sh
  checkmate plan open <planId> --target <targetId@rev> <<'EOF'
  { "objective": "<from the oracle>", "context": { "sources": ["docs/checkout.md"] } }
  EOF
  ```

  Use the oracle's requirements when the oracle gives them. Else give the sources only. When a source needs a tool that the target profile does not list, for example a Jira MCP server, add it as an object: `"tools": [{ "name": "jira", "kind": "mcp", "purpose": "Read the ticket." }]`. A string limits the plan to the named profile tools.

## Begin a run

1. Run `checkmate run gate <planId@rev> --build <build>`. Without `--tests`, it selects the ready tests. Give `--tests <T1,T2>` when the oracle names tests. When it does not print `completed`, stop and report the `reason:` lines to the oracle.
2. Use the oracle's run ID. When the oracle gives none, run `checkmate run list` and use the next free `run-<n>`.
3. Run `checkmate run begin <runId> <planId@rev> --build <build> --instance <instanceId> --actor claude:execute` once, with the same selection. You can leave out `--instance` only when the target has one active instance. Add `--retest-of <runId>` for a retest. A retest must select each ready test with an open defect of the earlier run and each ready regression test. A gate without `--tests` selects them.
4. When it does not print `completed`, no run exists. Stop and report the `reason:` lines.

An overlap warning names the other run and the shared open tests on the instance.

- After a rejected result: run `checkmate status <planId>` first. A `why` line `<runId> was rejected by <actor>: <rationale>` gives the reason of the oracle. Do the retest so that it addresses the rationale. When the rationale needs a plan change, stop and tell the oracle.
- Stalled run: run `checkmate run resume <runId> --actor claude:execute`. It checks the instance, the latest target profile, and the gate. When it gives `rejected`, stop and report the reasons. When it gives `completed`, check only the assertions that it lists. The oracle decides about tests marked `Actions may have occurred`.
- A reset with owner `factory`: ask the oracle for the reset before a test that needs a fresh state.

## Report to the oracle

Use this format when you show state or the end of a stage to the oracle in the terminal.

1. A Markdown table of the plans, tests, gaps, or runs that matter now. Use one row for each item and only the columns that help the decision. Copy IDs, titles, and statuses exactly from the database.
2. `Done:` one or two short lines about what you did.
3. `Next:` what is necessary to continue: the decision, who makes it, and the command or the UI action. Give enough context to decide.

```md
| Gap | Severity | Tests | Question                                             |
| --- | -------- | ----- | ---------------------------------------------------- |
| G1  | blocking | T3    | Does the promotion stack with the loyalty discount?  |
| G2  | blocking | T4    | Can a customer get a refund after the order shipped? |

Done: Saved checkout@1 with 4 tests. T1 and T2 are ready. T3 and T4 are blocked by G1 and G2.

Next: The oracle answers G1 and G2. Use `/checkmate:ui`, or run
`checkmate gap answer checkout G1 --kind clarify --source <source> --value "<answer>" --rationale "<why>"`.
When the oracle answers in this session, I record the answers and revise the plan in the same turn.
```

Useful columns:

- Plans: Plan, Loop, Waits on, Approval, Open gaps, Blocked tests.
- Tests: Test, Readiness, Capability, Title. In a run: Test, Outcome, Reason.
- Gaps: Gap, Severity, Status, Tests, Question.
- Runs: Run, Plan, Build, Completion, Coverage, Acceptance.

Stage reports:

- Setup: a table of the tools. The next step is usually a plan: `/checkmate:plan <planId> for <targetId>@<revision>` with the objective and the sources. When `readyForLiveExecution` is `false`, name the missing tool or check.
- Plan: the tests (Test, Readiness, Title) and the open gaps (Gap, Severity, Tests, Question). Name the gaps that the oracle must answer, or the plan approval.
- Revise: the changed tests and the gaps that are still open. Name the plan approval only when the target requires it.
- After the oracle answers a gap in this session, record the answer, then follow the revise skill at once. Do not ask the oracle to start it.
- Execute: the tests (Test, Outcome, Reason), the findings, and the retest verdicts. Name the result decision: `checkmate result accept|reject <runId> --rationale "<why>"`, or the review UI. For a new gap of the run, name `checkmate gap answer <planId> <gapId> ...`. It adopts the gap into the plan and records the answer.

## Changes to records

- Approved plan revisions, run records, and results do not change.
- The oracle can change the latest plan revision with `checkmate plan edit <planId@rev>`. A revision without an approval and without a run changes in place, and the log records the edit. An approved or used revision gives a new revision. Do not edit a plan unless the oracle asks. When the edit removes a test, add `--rationale "<why>"` with the reason of the oracle. This works also for a test of an answered or deferred gap.
- To bring the gaps of a run into the plan, the oracle runs `checkmate plan adopt-gaps <planId@rev> --run <runId>`. The same edit rules apply. `checkmate gap answer <planId> <gapId>` on a run gap adopts it and records the answer in one step.
- For a small change, send only the changes with `checkmate plan edit <planId@rev> --patch`. Key each requirement, test, assertion, and gap by its ID. Give only the changed fields. A new ID adds an item. `null` removes it:

```sh
checkmate plan edit checkout@2 --patch <<'EOF'
{ "tests": { "T2": { "assertions": { "A3": { "check": "totalPLN equals 240.", "checkKind": "deterministic" } } } } }
EOF
```
