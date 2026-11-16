---
name: test-trigger-criteria-file
description: A plain request to test a change loads the test skill, not the plan skill.
tags: [trigger, test]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit]
---

Take this change for test. The acceptance criteria are in ticket.md.
