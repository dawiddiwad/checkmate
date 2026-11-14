# Concepts

> **Reference** · The terms of this manual, the stages, and who owns what. Read this page once. The other pages use these terms without a new explanation.

Checkmate keeps one QA record for a workspace. Agents and people change the record only through commands, and each change has a name and a reason.

<img src="../img/roles.png" alt="Diagram: four roles share one record. In the centre, the Checkmate record, .checkmate/checkmate.db, with targets, plans and gaps, decisions, runs and evidence, findings, and the operation log. The planner turns a ticket into tests and writes a gap for each unclear requirement. The oracle answers gaps, approves plans, and accepts results, and is an agent or a person. QA runs the tests, early and again on each new build. Planner, oracle, and QA write to the record. The factory runs the agents and their sandboxes and builds and fixes the code. It reads the record, and it writes only through the commands that it runs, such as run begin. Below the record, a human can make the oracle's decisions in the review UI. Checkmate keeps the record. It does not start, schedule, or message agents, and it does not change code." width="100%"/>

## The roles

| Role    | Job                                                                                 |
| ------- | ----------------------------------------------------------------------------------- |
| Planner | Runs the plan and revise stages. Turns a ticket into tests and records gaps.        |
| Oracle  | Answers gaps, approves plans, and accepts results. An agent or a person.            |
| QA      | Runs the execute stage. Records results, evidence, defects, and new gaps.           |
| Factory | Runs the agents, their sandboxes, and the builds. Fixes the code. Reads the record. |

A **human** is a person who uses the review UI. A human makes the oracle's decisions there.

In solo mode, you are the oracle, and Claude Code does the work of the planner and QA. In team mode, the factory gives each stage to an agent.

## The stages

Checkmate has five stages. Between the stages, the oracle decides.

| Stage   | Does                                                        | Skill                | Next decision                |
| ------- | ----------------------------------------------------------- | -------------------- | ---------------------------- |
| Setup   | Checks the tools and the target. Saves a target profile.    | `/checkmate:setup`   | None.                        |
| Plan    | Writes revision 1 of a plan: requirements, tests, and gaps. | `/checkmate:plan`    | Answer the gaps.             |
| Revise  | Applies the answers. Writes the next revision.              | `/checkmate:revise`  | Approve the revision.        |
| Execute | Runs the tests. Records results, evidence, and findings.    | `/checkmate:execute` | Accept or reject the result. |
| Report  | Exports a plan or a run as HTML, Markdown, or JSON.         | `/checkmate:report`  | None.                        |

The plugin has two more skills. `/checkmate:status` tells where a plan is in the loop. `/checkmate:ui` starts the review UI.

## The records

**Target.** The application under test. A target profile has a base URL, capabilities, allowed operations, and tools. Its reference is `<targetId>@<revision>`, for example `shop@1`.

**Capability.** A label for how a test drives the target, for example `browser` or `http`. A capability does not name a fixed tool.

**Operation.** An action that a test can do on the target, for example `create_order`. A test can use only the allowed operations of the target.

**Tool.** A command line tool, an MCP server, or a Claude Code skill that a stage can use. Checkmate records the tools. The host gives the permission to use them.

**Plan.** The tests for one objective, for example one ticket. A plan has revisions. Its reference is `<planId>@<revision>`, for example `checkout@2`.

**Requirement.** One statement to verify, with its source.

**Test.** One action and a list of assertions. A test is `ready`, `blocked`, or `deferred`.

**Assertion.** One check with a known expected value, for example `totalPLN equals 240.` Its reference is `<testId>.<assertionId>`, for example `T2.A1`.

**Gap.** A question that the sources do not answer. An open blocking gap blocks the tests that it affects.

**Decision.** The oracle's answer to a gap: `clarify`, `accept_assumption`, or `defer`. The revise stage applies it.

**Approval.** The oracle's verdict on a plan revision or on a result: approved or rejected.

**Run.** One execution of selected tests of a plan revision on one build. A retest is a new run on a new build.

**Finding.** A defect or a potential issue that a run found.

**Evidence.** The bytes that show an observation, for example a page excerpt, an HTTP exchange, or a screenshot.

**Result.** The final record of a run: completion, test outcomes, and coverage.

## The loop

One ticket goes around the loop until its tests pass:

1. The planner writes a plan. Unclear requirements become gaps.
2. The oracle answers the gaps. The planner writes a new revision. The oracle approves it.
3. QA runs the tests. Unclear behavior in a run becomes a new gap.
4. The factory fixes the code and makes a new build. QA retests.
5. When the tests pass, the oracle accepts the result.

QA can run the ready tests early, before the feature exists. Then most tests fail, and this is correct. `checkmate status <planId>` names the loop state and the role that acts next. [Commands](commands.md#loop-states) lists the states.

## Who owns what

| Checkmate owns                                                  | The host (Claude Code) owns               |
| --------------------------------------------------------------- | ----------------------------------------- |
| The contracts and the rule checks                               | The agent loop, the model, and context    |
| The record of target and plan tools                             | Tool installation and tool access         |
| The database, the digests, and the operation log                | Authentication                            |
| The gates: approval, readiness, prerequisites, and dependencies | Tool permissions and the `--allow` rules  |
| Outcomes, coverage, and exports                                 | Browser sessions and access to the target |
| The review UI on `127.0.0.1`                                    |                                           |

The oracle owns the scope, the decisions, and release decisions. The factory owns application startup and fixes. The workspace owner owns the evidence and how long it stays.

Content of the target cannot authorize a change to a request or a plan. [Limits](record.md#limits) lists what the checks show and what they do not show.

## Next

- [Test in Claude Code](../guides/claude-code.md): the loop in solo mode.
- [Run Checkmate from a factory](../guides/factory.md): the loop in team mode.
