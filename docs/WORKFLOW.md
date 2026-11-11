# Workflow

Run Checkmate in the application workspace. All callers use its `.checkmate/checkmate.db`. Skills read the current records before they act, so a UI edit or another agent's decision is visible on the next task.

## In Claude Code

Install the plugin as shown in the [README](../README.md). The plugin includes the commands and the review UI. There is no separate npm install.

1. Give Claude the target URL, permitted operations, and context sources. Ask it to open a target request, then run `/checkmate:setup <targetId>`. Name the host tools that can reach the application, tracker, or documentation. Setup records which tools are available.
2. Give Claude the objective and requirements. Ask it to open a plan request, then run `/checkmate:plan <planId>`. Name the ticket or other source that defines the expected behavior. Plan instructions can add context or narrow tool use.
3. Review the plan and answer its gaps. The caller can clarify a requirement, accept an explicit assumption, or defer work. A deferred gap leaves coverage incomplete.
4. Run `/checkmate:revise` to apply the decisions. Review and approve the resulting revision.
5. Run `/checkmate:execute` with the plan revision, selected tests, build, and run ID. Claude records each assertion with evidence in the database.
6. Run `/checkmate:report` to read the current result. Review the evidence and accept or reject the result.

Open `/checkmate:ui` at any point. A human can answer gaps, approve plans, accept results, and edit plans there. Saving an edit creates a revision. Coverage follows the tests' requirement mappings; it is not a manual pass/fail field. Existing runs keep their original plan revision.

Claude presents plans, tests, and gaps in short tables. Each response states what changed and which action or decision is needed next. Execution completion, test outcomes, and coverage are separate facts.

## CLI example

The examples below use the optional npm CLI. A plugin session uses the same commands through `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js"`.

The actor defaults to the workspace Git user or operating-system user. Set `CHECKMATE_ACTOR` or pass `--actor` to use a specific name.

1. Open and set up a target:

   ```sh
   checkmate target open checkout-local --base-url http://127.0.0.1:4173 \
     --capabilities browser,http --operations read_catalog,create_fixture_order,apply_fixture_discount \
     --context-instructions "Read the checkout ticket and linked acceptance criteria." \
     --tool-instructions "Use the host browser and HTTP tools. Use fixture data only."
   ```

   ```text
   /checkmate:setup checkout-local
   ```

2. Open a plan from a request ([payload](CONFIGURATION.md#plan-request)), then ask Claude to plan:

   ```sh
   checkmate plan open checkout --target checkout-local@1 < plan-request.json
   ```

   ```text
   /checkmate:plan checkout
   ```

   An unclear requirement becomes an open blocking gap. For example: `G1: Does the promotion stack with the loyalty discount?`

3. Record the caller's answers:

   ```sh
   checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
     --value "The promotion replaces the loyalty discount. The quote total is 240 PLN." \
     --rationale "Product owner decision."
   checkmate gap answer checkout G2 --kind defer \
     --value "Refunds are out of scope for this release." --rationale "Product owner decision."
   ```

   ```text
   /checkmate:revise checkout
   ```

4. Read and approve the new revision:

   ```sh
   checkmate plan show checkout@2 --fields readiness,assertions
   checkmate plan approve checkout@2 --rationale "Tests and assertions match the brief."
   ```

5. Execute the selected tests:

   ```text
   /checkmate:execute checkout@2, tests T1,T2,T3, build fixture-build-1, run ID run-1
   ```

   The skill checks the gate, begins the run, records evidence and outcomes, and finishes the run. Evidence bytes stay in the database.

6. Read the result and record the caller's decision:

   ```sh
   checkmate run show run-1
   checkmate result accept run-1 --rationale "The defect in T3 is real. Fix before release."
   ```

   Acceptance records the caller's assessment. It does not mean every test passed.

## Delegation from another agent or CI

An agent in Claude Code can invoke a Checkmate skill or give its subagent the skill instructions, plugin root, workspace, subject ID, and applicable tool permissions. The subagent reads and writes through the bundled commands. It must read the database again before each stage and return the recorded status. Do not rely on inherited chat summaries for plan revisions or decisions.

`checkmate delegate` starts a fresh Claude Code session. It can use the tools available through that session's host configuration. A tool or context item that exists only in the parent conversation is not automatically available to a new process. Put required source content in the plan request, or configure access to it in the delegated host.

Open the subject before delegation:

```sh
checkmate delegate setup checkout-local --allow Read --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
checkmate plan open checkout --target checkout-local@1 < plan-request.json
checkmate delegate plan checkout --allow Read --allow "Bash(node *)"
# The caller answers gaps, applies decisions, and approves checkout@2.
checkmate run begin run-7 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-7 --allow Read --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
```

These permissions illustrate a host that uses Playwright CLI and Node.js. Give permissions for your own tools. Checkmate does not install a browser tool or connector. Instructions do not grant host permissions.

The parent checks the database after the worker finishes. Read [CLI](CLI.md) for deadlines and failure handling. Agents can also call `gap answer`, `plan approve`, `plan reject`, `result accept`, and `result reject` directly with the caller's decision and rationale.

## Review and retest

The plan detail page links its runs. Resolved and deferred gaps are collapsed and muted. History opens the latest change, shows five earlier changes collapsed, and loads the rest only when requested. Refresh restores this compact view.

Plans, Runs, and Log start with the newest entries. Select 25, 50, or 100 rows per page. Type to search the displayed columns, or select a filter; results update automatically. The timestamp column switches between newest and oldest first.

A finished run offers HTML and JSON downloads. Use Print / Save PDF for a PDF from the browser. Reports are exports; the database remains authoritative.

After a fix, begin a new run with the actual build and `--retest-of <priorRunId>`. A different build is required unless the prior result's latest decision is `rejected`. An authorized repeat to correct rejected evidence can use the same build. Select the changed tests and their prerequisites. Unselected requirements stay uncovered in that retest. The original result and its evidence remain available.

## After a review decision

Claude first reads the exact subject with `plan show --json` or `run show --json`. It reads the verdict and rationale from `approval.latest` or `result.latestDecision`. The command's top-level `reasons` array reports command problems, not reviewer feedback.

| Decision                             | Next step                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan approved                        | Execute only the approved revision and the scope the caller authorized.                                                                                         |
| Plan rejected                        | State the rationale. Apply pending gap answers with `plan revise`, or make other authorized corrections with `plan edit`. Request approval of the new revision. |
| Result accepted                      | Keep the observations and outcomes. Acceptance does not turn failed tests into passes.                                                                          |
| Result rejected                      | State the rationale and the change it requires. If the caller authorizes a repeat, create a new run linked with `--retest-of`; keep the rejected result intact. |
| Gap clarified or assumption accepted | Read the value, rationale, and source. Apply the pending answer with `plan revise`, then review the new revision.                                               |
| Gap deferred                         | Apply the pending answer with `plan revise`. Affected scope stays deferred and does not become tested coverage.                                                 |

A rejection by itself does not authorize another execution. Use any explicit follow-up instruction already given by the caller. If the required action is unclear, ask for that decision instead of repeating the first run. Do not invent a build ID or create an unrelated run to bypass retest validation.

If a rejected plan also has pending gap answers, apply the answers first. Keep the original rejection rationale through that revision. Make any remaining authorized correction with `plan edit`, or report the outstanding correction with `needs_decision`.

Evidence feedback must change the next capture. For example, if the rationale requests full-page screenshots, the authorized repeat must capture actual full-page screenshots with the host's browser tool. Text observations alone do not meet that request. If the required tool cannot capture them, report the missing capability.

Gap answers stay pending until applied. There is no separate gap rejection command. A rejected plan or run does not automatically defer its gaps or erase their answers.

The review UI shows the current verdict and rationale. You can change that decision with a new rationale and confirmation; the previous decision stays in history. Pending and applied gap answers also show their rationale and source.
