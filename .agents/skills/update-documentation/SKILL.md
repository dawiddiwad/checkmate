---
name: update-documentation
description: Keep Checkmate contracts, workflows, examples, and documentation consistent.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Read the changed code and tests before editing documentation.
Use ASD-STE100 style, as AGENTS.md says.

Check `plugin/contracts/`, `plugin/src/index.ts`, `plugin/skills/`, and the contents of `plugin/`.
Edit a generated skill in `scripts/templates/`. See [tool names and generated skills](../../wiki/development-procedures.md#tool-names-and-generated-skills).
Update the relevant files in `docs/`, `README.md`, and `.agents/wiki/`.

Distinguish operation completion, test outcomes, and coverage.
State which controls belong to Checkmate and which belong to the host.
Do not claim that evidence structure proves observation accuracy.
Do not include credentials or raw tool transcripts in examples.

Run `npm run phase:verify`. Check agent Markdown with Prettier explicitly because the default ignore file excludes it.
