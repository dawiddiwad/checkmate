---
name: qa
description: Keep the QA record of a change in Checkmate. Use it when you open a change for test, or when a test session of a change must be recorded.
---

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path.

Checkmate does not take part in the test session. The tester tests and knows nothing about Checkmate. Do not tell a tester agent to log.

The person or the orchestrator does these steps, not the tester:

1. Run the commands in the project directory. If you change the directory, set `CHECKMATE_WORKSPACE` to the project directory.
2. If the project has no target, record one: `checkmate target open <targetId> --entry-point <name>:<url|command|value>:<purpose> --capabilities <a,b> --operations <a,b>`.
3. Open the change: `checkmate open <changeId> --target <targetId>`.
4. Start the test session with `CHECKMATE_RECORD=<changeId>` in its environment, for example `CHECKMATE_RECORD=<changeId> claude`. Add `CHECKMATE_BUILD=<build>` to name the build. When the session ends, the plugin hook starts `checkmate record <changeId>` for it, and a copy of the session writes the record.
5. An orchestrator that must wait for the record can run `checkmate record <changeId> --session <sessionId> [--build <build>]` after the session instead. Use one of the two ways, not both.

In a team, each tester has its own actor, for example `CHECKMATE_ACTOR=qa:a1`, and its own recorder: start the test session or run `record` with the actor of that tester. A merger and a verifier work on the record. They get their text from `checkmate guide <changeId> --role <merger|verifier>`.
