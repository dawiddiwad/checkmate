# Review in the browser

> **Guide** · For people who read the record in a browser.

The review UI shows the operation log, the targets, and their instances. It runs on your computer and listens on `127.0.0.1` only.

The UI does not show the journal yet. Read a change with `checkmate show <changeId>` and `checkmate export <changeId>`.

## Start the UI

```sh
checkmate ui [--workspace <path>] [--port <n>]
```

In Claude Code, run `/checkmate:ui`. The first output line is `completed ui url=<url>`. Open the URL in a browser on the same computer. The workspace must have a store.

## Pages

| Page               | Shows                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Log                | Every write: the time, the actor, the command, the status, and the subjects. Filter, sort, and page it. |
| Settings, Targets  | Each target with its latest revision and its active instances.                                          |
| Settings, a target | The entry points, the tools, the profile, the revision history, and the instances.                      |

On a target page, you can add an instance and retire an instance. Each form records your name as the actor. The UI fills in the same default actor as the commands. Change it with `actor: <name>` in the header.

The pages update when another process writes to the record.

## Next

- [The record](../reference/record.md#review-ui): the safety rules of the UI.
