---
name: status-trigger
description: A question about the state of a plan loads the status skill.
tags: [trigger, status]
runs: 3
max_turns: 10
timeout_seconds: 240
allowed_tools: [Bash, Read, Write, Edit]
---

What is the state of plan stock, and what should I do next?
