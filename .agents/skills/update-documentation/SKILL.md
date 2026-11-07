---
name: update-documentation
description: Keep Checkmate contracts, workflows, examples, and documentation consistent.
---

Read the changed code and tests before editing documentation.
Use ASD-STE100 style. Use short sentences, consistent terms, and explicit steps.

Check `contracts/`, `src/index.ts`, `skills/`, and package contents.
Update the relevant files in `docs/`, `README.md`, and `.agents/wiki/`.

Distinguish operation completion, test outcomes, and coverage.
State which controls belong to Checkmate and which belong to the host.
Do not claim that evidence structure proves observation accuracy.
Do not include credentials or raw tool transcripts in examples.

Run `npm run phase:verify`. Check agent Markdown with Prettier explicitly because the default ignore file excludes it.
