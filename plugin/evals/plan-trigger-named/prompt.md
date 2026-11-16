---
name: plan-trigger-named
description: A request for a test plan loads the plan skill, not the test skill.
tags: [trigger, plan]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit]
---

Use /checkmate:plan to make a test plan for ticket.md. The target is shop.
