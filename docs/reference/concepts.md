# Concepts

> **Reference** · The terms of this manual, and who owns what. The other pages use these terms without a new explanation.

Checkmate keeps one QA record for a project. The agent tests freely and logs what it sees. Checkmate stores the entries and derives the views from them.

## The terms

| Term     | Meaning                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Target   | The application under test: its entry points, capabilities, and allowed operations. `target open` records it.                |
| Instance | One place where the target runs, with a value for each entry point. A change can name one instance.                          |
| Change   | The work under test, for example a ticket, a merge request, or a feature. `open` starts its journal.                         |
| Build    | One version of the application that the agent tests. `base` is the version before the change. Each entry can name its build. |
| Journal  | The entries of one change, in the order of the writes.                                                                       |
| Entry    | One fact in the journal. Each entry has a kind, an ID, an actor, and usually a build.                                        |
| Actor    | The name of the writer of an entry. Each write records it.                                                                   |
| Gap      | An open item: a thing that the record does not show yet. `gaps` derives it from the entries. A gap is an idea, not a rule.   |
| Issue    | One defect that one or more testers reported. A merger groups reports into issues.                                           |

## Entry kinds

| Kind          | Holds                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `criterion`   | A rule or an acceptance criterion that the change must meet.                                                     |
| `observation` | What the agent did and saw. A value on an earlier build makes a baseline.                                        |
| `defect`      | A thing that is wrong on a build: the title, the severity, the expected and the actual result, and the evidence. |
| `question`    | A question for the PM.                                                                                           |
| `verdict`     | The result of a retest of a defect on a later build: `fixed` or `not_fixed`.                                     |
| `note`        | Anything else, for example where the agent explored, or a changed area.                                          |
| `issue`       | The merger's group of defect reports that describe one defect.                                                   |

Checkmate also writes two kinds for commands: `answer` (from `answer`) and `decision` (from `accept` and `reject`).

`checkmate guide` prints the fields of each kind from the schemas in `plugin/contracts/journal-*.schema.json`.

## Who owns what

| Owner        | Owns                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| The tester   | What to test, how, and in which order. Checkmate does not limit it.                                             |
| The PM       | The answers to questions.                                                                                       |
| The oracle   | The decision on a build: `accept` or `reject`.                                                                  |
| The merger   | The grouping of defect reports into issues. The merger does not test.                                           |
| The verifier | The check of the items that `verify` lists. The verifier does not explore beyond the list.                      |
| The host     | The agent loop, the model, the authentication, the tools, and the permissions. Checkmate does not start agents. |
| Checkmate    | The store, the entry checks, the derived views, and the operation log.                                          |

The checks of Checkmate show that an entry has the right shape and valid references. They do not show that an observation is true.

## Next

- [Commands](commands.md): every command, the gap kinds, and several testers.
- [The record](record.md): the database and its limits.
