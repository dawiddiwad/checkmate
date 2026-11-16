# Test in Claude Code

> **Guide** · For people who use Claude Code with the Checkmate plugin.

You give Claude a change to test. Claude tests it the way it tests without Checkmate, and logs what it sees in the journal of the change. You read the record, answer the questions, and decide on each build.

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

### 1. Ask Claude to test a change

```text
/checkmate:qa test the coupon change in SHOP-12 on http://127.0.0.1:4173
```

The `qa` skill tells Claude how to start: it records the target if the project has none, opens the change, and reads `checkmate guide <changeId>`. The guide tells what the record holds and how to write an entry. It does not tell Claude what to test.

### 2. Read the record

```sh
checkmate show shop-12
checkmate gaps shop-12 --build b1
```

`show` prints the criteria, a matrix of the observations on each build, the defects with their verdicts, the questions with their answers, and the decisions. `gaps` prints the open items of a build: things that the record does not show yet.

### 3. Answer the questions

```sh
checkmate answer shop-12 Q1 --answer "The coupon does not stack with loyalty."
```

The next `guide` call of a tester prints the answer.

### 4. Decide on the build

```sh
checkmate accept shop-12 --build b1 --rationale "The totals match the ticket."
```

`accept` and `reject` print the gaps of the build at the time of the decision.

### 5. Test the next build

Tell Claude the new build. The entries name their build. `gaps` then lists the defects to retest and the baselines to measure again.

### 6. Export the record

```sh
checkmate export shop-12 --out qa/shop-12.json
```

## Several testers

Two or more agents can test one change. Each agent tests alone and logs into the same journal with its own actor, for example `CHECKMATE_ACTOR=qa:a1`. A merger then merges their defects into issues, and a verifier checks the issues that only one tester found. Each role reads its text from `checkmate guide <changeId> --role <tester|merger|verifier>`. Read [Several testers](../reference/commands.md#several-testers).

## When something goes wrong

| You see                                   | Do this                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `No Checkmate store in <dir>`             | Run the command in the project directory, or set `CHECKMATE_WORKSPACE`, or pass `--workspace <path>`. |
| `Unknown change: <id>. The store ... has` | Check the change ID and the store path in the reason.                                                 |
| `refused` lines after `log`               | Send only the refused entries again, with the fixes that the lines give. The saved entries stay.      |

## Next

- [Concepts](../reference/concepts.md): the terms and who owns what.
- [Commands](../reference/commands.md): every command and the gap kinds.
