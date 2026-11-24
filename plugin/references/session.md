# Same-session rules

> **Agent only:** This file contains repository or workflow instructions for coding agents.

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

- Setup: when the oracle gives the URL of the application, run the quick setup. It records the target and its first instance:

  ```sh
  checkmate setup --url <url>
  ```

  Report the `assumed:` lines. Use `target open` below only when the oracle names the operations, the tools, or other choices:

  ```sh
  checkmate target open <targetId> --entry-point "web:url:Storefront." --capabilities browser,http \
    --operations read_catalog,create_fixture_order --tool "playwright-cli:cli:Drive the browser."
  ```

  Give `--entry-point <name>:<url|command|value>:<purpose>` once for each entry point. Give `--tool` once for each tool that the oracle names. Ask the oracle for a missing entry point, capability, or operation. Do not invent operations.

- Plan: run `checkmate target show <targetId>` for the latest target revision. Then record the request. Give the ticket and the product documentation as sources. Leave out the plan ID: Checkmate takes it from the first source and prints it as `planIdFrom`. Use that `planId` in the next commands:

  ```sh
  checkmate plan open --target <targetId@rev> --objective "<from the oracle>" --source jira:SHOP-12 --source docs/checkout.md
  ```

  To name the plan, put its ID first, for example `checkmate plan open shop-12 --target <targetId@rev> ...`. Never write `stdin` or `-` as the plan ID. A bare word is a plan ID, and the command refuses these two words.

  To give requirements or tools, send the full request in a heredoc in place of the flags. The heredoc is standard input: it has no word on the command line.

  ```sh
  checkmate plan open --target <targetId@rev> <<'EOF'
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
- A data kind `environment` or `isolation`: Checkmate does not reset the data. Ask the oracle for the data policy before a test that changes data. Checkmate runs a reset command (`--reset`) only before a run begins or an exploration starts. `explore follow` does not run it again.

## Report to the oracle

Lead with the outcome. Then ask only for the decision or information you need. Use plain words. When an oracle decision is waiting, name the item and say where to review it in the Checkmate review UI. Give the URL when you already know it. The oracle can also reply here.

Run the Checkmate commands yourself. Keep CLI command lines, flags, and bundle paths out of replies. Use command output to choose your action and learn what happened. Summarize the relevant facts and reasons. Include a table only when it helps the oracle compare several items or the oracle asks for detail.

Example: “Saved checkout revision 1. Two tests are ready and two are blocked. Does the promotion stack with the loyalty discount, and can customers get a refund after shipment? You can answer here or on the plan page in the Checkmate review UI.”

- Setup: say whether the application answered. Name any prerequisite or data policy that blocks work. If the oracle asked only for setup, stop there.
- Plan and revise: say what you saved. Ask for the open decisions or approval when needed. After the oracle answers a gap here, record the answer and revise the plan in the same turn.
- Execute: give the recorded test outcomes and findings. When a result needs a decision, ask the oracle to accept or reject it on the run page or in this conversation.

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
