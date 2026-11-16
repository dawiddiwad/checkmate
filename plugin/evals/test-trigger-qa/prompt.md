---
name: test-trigger-qa
description: A plain request to test a change loads the test skill, not the plan skill.
tags: [trigger, test]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit]
---

QA the restock badge change from ticket.md, please.
