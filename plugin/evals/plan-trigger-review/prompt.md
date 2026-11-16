---
name: plan-trigger-review
description: A request for a test plan loads the plan skill, not the test skill.
tags: [trigger, plan]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit]
---

Review the requirements in ticket.md and list what is unclear before testing.
