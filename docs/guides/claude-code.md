# Test in Claude Code

> **Guide** · For people who use Claude Code with the Checkmate plugin. This is solo mode: you are the oracle.

You give Claude a target and a ticket. Claude writes the tests and runs them, and you make each decision in the review UI or in the chat.

## Before you start

- Claude Code with the plugin. Install it from the marketplace. You do not need npm.

  ```text
  /plugin marketplace add dawiddiwad/checkmate
  /plugin install checkmate@checkmate
  ```

- Node.js 24.12.0 or later.
- For browser tests, Playwright CLI: `npm i -g @playwright/cli`.
- The application runs and you know its URL. Checkmate does not start it.

Open Claude Code in the application workspace. Checkmate keeps its record in `.checkmate/checkmate.db` there. Add `.checkmate/` to `.gitignore`.

The plugin has no global `checkmate` command. Claude runs the plugin CLI for you. To type the commands yourself, also install the npm CLI: `npm i -g @xoxoai/checkmate`.

## Test a change

One request tests a change. Claude asks no question when a default exists:

```text
/checkmate:test the change in ticket.md, app at http://127.0.0.1:4173
```

When the store has no target, Checkmate sets one up from the URL. Without a build, it uses the short git commit, or the date and time when the workspace has no git. Without an objective, it tests the change that the sources describe. Claude reports each value that Checkmate assumed, so that you can correct it.

Claude runs `checkmate test --session`. The first test of a plan explores: Claude starts independent testers as agents of your session. You see each tester and what it does in the session, and the testers count in the usage of the session. The testers get the Checkmate tasks, but not the Checkmate skills. Checkmate records the work of each tester, merges the reports, and verifies the claims with one reporter. A later test also runs the stored tests of the plan again. Claude reports the claims and the open questions. You answer the questions and decide the `suspected` and `unresolved` claims in the review UI or in the chat. A plan is not necessary before the first test. Plan stored tests with the steps below.

## Steps

### 1. Set up the target

Give the entry points, the capabilities, and the operations that tests can do. An entry point is a named way into the application, for example the `web` URL. Give the first instance too: the place where the application runs, with a value for each entry point. You can also name tools, for example an MCP server.

```text
/checkmate:setup shop with entry point web (url), capabilities browser and http,
operations read_catalog and create_order. First instance: local, web at http://127.0.0.1:4173
```

Claude checks each tool and the target, saves the profile `shop@1`, and adds the instance `local`. To add another instance later, for example a staging server, open Settings in the review UI, or ask Claude.

### 2. Plan

Give the objective and the requirements, or the sources to read.

```text
/checkmate:plan checkout for shop@1. Objective: verify checkout totals. Source: docs/checkout.md
```

Claude writes revision 1. Claude adds edge-case tests for each rule, for example a value exactly at a threshold. Each point that the sources do not settle and that changes an expected value becomes an open gap, for example `G1: Does the promotion stack with the loyalty discount?` Give the existing product documentation as a source too. Claude plans regression tests for the existing rules near the change that the documentation states and marks them with `"type": "regression"` in the test metadata.

### 3. Answer the gaps

Open the review UI and answer each gap there.

```text
/checkmate:ui
```

You can also give the answer in the chat, for example: "Answer G1: the promotion replaces the loyalty discount. The total is 240 PLN. Source: product decision."

### 4. Revise and approve

Claude writes revision 2 from your answers in the same turn. You can also ask for it: `/checkmate:revise checkout`. Read it in the UI. To change it, click `Edit plan`. Approve it when the target requires plan approval.

### 5. Execute

```text
/checkmate:execute checkout@2, tests T1,T2,T3, build b1, run ID run-1
```

Claude checks the gate, records each assertion with evidence, and closes each test. Then it makes up to 10 probes of edge cases near the tested rules, records the findings, and finishes the run.

When the target has two or more active instances, name the instance, for example `/checkmate:execute checkout@2, tests T1,T2, build b1, instance staging`. QA reads the entry values of that instance.

To run before the gaps are answered, ask for the ready tests only, for example `/checkmate:execute checkout@1, ready tests only, build b1`.

### 6. Accept the result

Accept or reject the result on the run page of the UI. When the run found new gaps, click `Answer` to answer a gap, or `Bring into plan` to add it to the plan without an answer.

### 7. Get the report

On the run page, click `Download report`. Or ask Claude:

```text
/checkmate:report run-1 as html in reports/run-1.html
```

## Ask where you are

```text
/checkmate:status checkout
```

Claude reads the record and tells you the loop state, who acts next, and the next command. You can also ask in your own words, for example "Where is the checkout plan in the loop?"

## How Claude reports

After each stage, Claude shows a table of the items that matter, a `Done:` line, and a `Next:` line with the decision and who makes it. Claude reads the database before it answers a question about the state, because another session or the UI can change it.

## Example

A report after a plan with gaps:

```md
| Gap | Severity | Tests | Question                                            |
| --- | -------- | ----- | --------------------------------------------------- |
| G1  | blocking | T3    | Does the promotion stack with the loyalty discount? |

Done: Saved checkout@1 with 4 tests. T1 and T2 are ready. T3 is blocked by G1.

Next: The oracle answers G1. Use `/checkmate:ui`, or run
`checkmate gap answer checkout G1 --kind clarify --source <source> --value "<answer>" --rationale "<why>"`.
Then run `/checkmate:revise checkout`.
```

## Next

- [Decide as the oracle](oracle.md): the three kinds of answers, plan edits, and approvals.
- [Review in the browser](review-ui.md): the pages of the UI.
- [Runs and evidence](../reference/runs.md): what a result means.
