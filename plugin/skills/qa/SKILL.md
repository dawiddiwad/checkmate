---
name: qa
description: Keep the QA record of a change in Checkmate. Use it when you test a change, a ticket, a merge request, or a build of an application.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path.

Checkmate is the record of your test work. It does not tell you what to test or how.

1. Run the commands in the project directory. If you change the directory, set `CHECKMATE_WORKSPACE` to the project directory.
2. If the project has no target, record one: `checkmate target open <targetId> --entry-point <name>:<url|command|value>:<purpose> --capabilities <a,b> --operations <a,b>`.
3. Open the change: `checkmate open <changeId> --target <targetId>`.
4. Read the guide: `checkmate guide <changeId>`. It tells what the record holds and how to write an entry.

In a team, each agent has its own actor, for example `CHECKMATE_ACTOR=qa:a1`. A tester, a merger, and a verifier get their text from `checkmate guide <changeId> --role <tester|merger|verifier>`.
