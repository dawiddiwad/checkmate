---
name: retest-trigger
description: A request to retest a run on a new build loads the execute skill, not the plan skill.
tags: [trigger, execute, retest]
runs: 3
max_turns: 20
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit]
---

The factory fixed the defect. Retest run-1 on the new build b2.
