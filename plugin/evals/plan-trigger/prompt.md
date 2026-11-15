---
name: plan-trigger
description: A request to plan tests for a ticket loads the plan skill.
tags: [trigger, plan]
runs: 3
max_turns: 12
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit]
---

Plan tests for the ticket in ticket.md. The target is shop.
