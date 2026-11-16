# Test in Claude Code

> **Guide** · For people who use Claude Code with the Checkmate plugin.

You open a change and let Claude test it. The test session knows nothing about Checkmate. When the session ends, the plugin starts a copy of the test session, and the copy writes the record. You read the record, answer the questions, and decide on each build.

## Before you start

- Claude Code with the plugin. Install it from the marketplace. You do not need npm.

  ```text
  /plugin marketplace add dawiddiwad/checkmate
  /plugin install checkmate@checkmate
  ```

- Node.js 24.12.0 or later.
- The application runs and you know its URL. Checkmate does not start it.

Open Claude Code in the project directory. Checkmate keeps its record in `.checkmate/checkmate.db` there. Add `.checkmate/` to `.gitignore`.

The plugin has no global `checkmate` command. Claude runs the plugin CLI for you. To type the commands yourself, also install the npm CLI: `npm i -g @xoxoai/checkmate`.

## Steps

### 1. Open the change

```sh
checkmate target open shop --entry-point "web:url:Storefront and HTTP API." --capabilities browser,http --operations read_catalog
checkmate open shop-12 --target shop
```

Record the target only once for each project. The `qa` skill tells Claude the same steps when Claude is the orchestrator.

### 2. Let Claude test

Start Claude Code in the project directory with `CHECKMATE_RECORD`, and give it the change to test. Do not tell it about Checkmate, and do not tell it to log. It tests the way it tests without Checkmate.

```sh
CHECKMATE_RECORD=shop-12 CHECKMATE_BUILD=b1 claude
```

`CHECKMATE_BUILD` is optional. A session without `CHECKMATE_RECORD` is never recorded.

### 3. The record is written when the session ends

When the session ends, the `SessionEnd` hook of the plugin starts `checkmate record shop-12 --session <sessionId> --build b1` in the background, and returns at once. The hook prints nothing in the session. The output of `record` goes to `.checkmate/tmp/record-hook-<sessionId>.log`. `checkmate operations --subject change:shop-12` shows the `record` row with its status: `completed`, `operational_error`, `interrupted`, or `rejected`.

To record by hand instead, run `checkmate record shop-12 --build b1` in a terminal in the project directory, outside the test session. Use one of the two ways, not both: a second recorder costs a second model call.

`record` copies the Claude Code session with `claude -p --resume <sessionId> --fork-session`. The copy has the memory of the test work. Its prompt holds the entry kinds and what the record already holds. It replies with what the tester did and found, the questions for the PM, and the answers, as one JSON array, and Checkmate logs that reply. It has no tool and does not test again. The test session does not see the copy. Give `--session <sessionId>` when the test session is not the latest session of the project. Line 1 of the output names the recorder session and the count of new entries. Read [record](../reference/commands.md#record).

### 4. Read the record

```sh
checkmate show shop-12
checkmate gaps shop-12 --build b1
```

`show` prints the criteria, a matrix of the observations on each build, the defects with their verdicts, the questions with their answers, and the decisions. `gaps` prints the open items of a build: things that the record does not show yet.

### 5. Answer the questions

```sh
checkmate answer shop-12 Q1 --answer "The coupon does not stack with loyalty."
```

The next recorder gets the answer in its prompt.

### 6. Decide on the build

```sh
checkmate accept shop-12 --build b1 --rationale "The totals match the ticket."
```

`accept` and `reject` print the gaps of the build at the time of the decision.

### 7. Test the next build

Tell Claude the new build. After the test, run `checkmate record shop-12 --build b2`. The entries name their build. `gaps` then lists the defects to retest and the baselines to measure again.

### 8. Export the record

```sh
checkmate export shop-12 --out qa/shop-12.json
```

## Several testers

Two or more agents can test one change. Each agent tests alone. Start each test session with the actor of that tester, for example `CHECKMATE_ACTOR=qa:a1 CHECKMATE_RECORD=shop-12 claude`. The hook runs one recorder for each session, one after the other. Each recorder logs into the same journal with its own actor. A merger then merges their defects into issues, and a verifier checks the issues that only one tester found. Each of these roles reads its text from `checkmate guide <changeId> --role <merger|verifier>`. Read [Several testers](../reference/commands.md#several-testers).

## When something goes wrong

| You see                                   | Do this                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `No Checkmate store in <dir>`             | Run the command in the project directory, or set `CHECKMATE_WORKSPACE`, or pass `--workspace <path>`. |
| `Unknown change: <id>. The store ... has` | Check the change ID and the store path in the reason.                                                 |
| `refused` lines after `log`               | Send only the refused entries again, with the fixes that the lines give. The saved entries stay.      |
| `No Claude Code session of <dir>`         | Pass `--session <sessionId>` to `record`.                                                             |
| `The recorder added no entry`             | Read the recorder session with `claude --resume <recorderId>`. Then run `record` again.               |

## Next

- [Concepts](../reference/concepts.md): the terms and who owns what.
- [Commands](../reference/commands.md): every command and the gap kinds.
