---
name: execute-refusal-retry
description: run finish is refused because a failed assertion has no defect. QA records the defect and runs run finish again.
tags: [behaviour, execute, refusal]
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Write, Edit]
---

Every test of the Checkmate run run-1 is closed. Finish the run now with `run finish`. Work without asking me questions.
