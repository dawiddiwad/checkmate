# Review in the browser

> **Guide** · For people who read the record in a browser.

The review UI shows the record of each change, the operation log, the targets, and their instances. It runs on your computer and listens on `127.0.0.1` only.

## Start the UI

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

In Claude Code, run `/checkmate:ui`. The first output line is `completed ui url=<url>`. Open the URL in a browser on the same computer. The workspace must have a store.

## Pages

| Page               | Shows                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changes            | Each change: the target, the builds, the open issues, the open questions, the decision on the latest build, and the last activity. This is the first page. |
| A change           | The record of one change as a QA report. Read [A change page](#a-change-page).                                                                             |
| Log                | Every write: the time, the actor, the command, the status, and the subjects. Filter, sort, and page it.                                                    |
| Settings, Targets  | Each target with its latest revision and its active instances.                                                                                             |
| Settings, a target | The entry points, the tools, the profile, the revision history, and the instances.                                                                         |

## A change page

The page shows these sections from top to bottom. Each section uses the same data as the commands.

| Section    | Shows                                                                                                                                      | Same data as        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Head       | The target, the instance, the builds, the counts, and the decision on each build with its rationale.                                       | `show`              |
| Issues     | The merged issues. Without a merge, each defect is an issue. Open an issue to read its steps, evidence, criteria, questions, and verdicts. | `issues`            |
| Criteria   | Each criterion and its source, with the ok, wrong, and other observations on each build.                                                   | `show` (the matrix) |
| Questions  | Each question, the actor who asked it, and the answer with the actor who answered it.                                                      | `show`              |
| Open items | The open items of the latest build, for all actors.                                                                                        | `gaps --all`        |
| Journal    | All entries in time order. Filter by kind, actor, and build.                                                                               | `export`            |
| Recorders  | Each `record` operation of the change: the time, the actor, the status, the saved and refused entries, and the reasons of a failure.       | `operations`        |

An evidence file opens in the browser. An image shows in the opened issue. A text file shows as text. The UI serves a file only when it is in the workspace and a journal entry names it as evidence.

On a change page, you can do two actions:

- Answer an open question as the PM. This does the same as `checkmate answer`.
- Accept or reject a build as the oracle, with a rationale. This does the same as `checkmate accept` and `checkmate reject`.

If Checkmate refuses the action, the reason shows next to the form.

On a target page, you can add an instance and retire an instance. Each form records your name as the actor. The UI fills in the same default actor as the commands. Change it with `actor: <name>` in the header.

The pages update when another process writes to the record.

## Next

- [The record](../reference/record.md#review-ui): the safety rules of the UI.
