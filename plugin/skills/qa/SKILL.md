---
name: qa
description: Keep the QA record of a change in Checkmate. Use it when you open a change for test, or when a test session of a change ends and its record must be written.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path.

Checkmate does not take part in the test session. The tester tests and knows nothing about Checkmate. Do not tell a tester agent to log.

The person or the orchestrator does these steps, not the tester:

1. Run the commands in the project directory. If you change the directory, set `CHECKMATE_WORKSPACE` to the project directory.
2. If the project has no target, record one: `checkmate target open <targetId> --entry-point <name>:<url|command|value>:<purpose> --capabilities <a,b> --operations <a,b>`.
3. Open the change: `checkmate open <changeId> --target <targetId>`.
4. Start the test session in the project directory.
5. After the test session, or after a turn of it, run `checkmate record <changeId> [--build <build>]` from outside that session. A copy of the session writes the record. Give `--session <sessionId>` when the test session is not the latest session of the project.

In a team, each tester has its own actor, for example `CHECKMATE_ACTOR=qa:a1`, and its own recorder: run `record` with the actor of that tester. A merger and a verifier work on the record. They get their text from `checkmate guide <changeId> --role <merger|verifier>`.
