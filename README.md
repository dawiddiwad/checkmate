#### □ □ ■ □

# Checkmate

### The QA record of free exploration.

[![npm version](https://img.shields.io/npm/v/%40xoxoai%2Fcheckmate)](https://www.npmjs.com/package/@xoxoai/checkmate)

Checkmate keeps the record of the test work on a change. The agent tests the way it tests without Checkmate, and does not talk to Checkmate. After the test session, `checkmate record` starts a copy of that Claude Code session, and the copy logs what the agent did and found as journal entries. Checkmate stores the entries, shows the open items that the record does not cover yet, and exports the record. Several testers can work on one change. A merger then merges their defects into issues, and a verifier checks the issues that only one tester found.

Checkmate does not tell the agent what to test or how. It keeps the record.

## In one minute

- A **target** is the application under test, with its entry points. An **instance** is one place where it runs.
- A **change** is the work under test, for example a ticket or a merge request. It has a journal.
- A **journal entry** is one fact: a criterion, an observation, a defect, a question, a verdict, a note, or an issue.
- **Gaps** are open items: things that the record does not show yet. They are ideas, not rules.
- The **PM** answers questions. The **oracle** accepts or rejects a build.
- The record is one SQLite file: `.checkmate/checkmate.db` in the project directory.

## In Claude Code

Install the plugin from the marketplace. You do not need npm.

```text
/plugin marketplace add dawiddiwad/checkmate
/plugin install checkmate@checkmate
```

Open the change, let Claude test it, and then record the test session from outside that session. To type the commands in a terminal, also install the npm CLI: `npm i -g @xoxoai/checkmate`.

```sh
checkmate open shop-12 --target shop
checkmate record shop-12 --build b1
```

Read [Test in Claude Code](docs/guides/claude-code.md).

## From the command line

```sh
npm i -g @xoxoai/checkmate
checkmate target open shop --entry-point "web:url:Storefront and HTTP API." \
  --capabilities browser,http --operations read_catalog,create_order
checkmate open shop-12 --target shop
checkmate record shop-12 --build b1
```

Run `record` after a Claude Code test session in the project directory. `checkmate guide shop-12` prints the entry kinds, their fields, and an example `checkmate log` call: the text that the recorder reads.

### Why the tester does not log

An agent that must log while it tests spends its attention on the record. It tests less and finds fewer defects. A copy of the session has the full memory of the test work, so it can write the complete record after the test, and the test session stays unchanged.

Checkmate needs Node.js 24.12.0 or later.

## Documentation

| To do this                                   | Read                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| Test a change in Claude Code                 | [Test in Claude Code](docs/guides/claude-code.md)             |
| Learn the terms and who owns what            | [Concepts](docs/reference/concepts.md)                        |
| Find a command, an entry kind, or a gap kind | [Commands](docs/reference/commands.md)                        |
| Merge the work of several testers            | [Several testers](docs/reference/commands.md#several-testers) |
| Know what the database keeps, and its limits | [The record](docs/reference/record.md)                        |
| Read the record in the browser               | [Review in the browser](docs/guides/review-ui.md)             |
| Build, test, or release Checkmate            | [Development](docs/development.md)                            |

## License

[MIT](LICENSE)
