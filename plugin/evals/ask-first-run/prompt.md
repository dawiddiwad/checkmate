---
name: ask-first-run
description: A first run on a URL that is not local asks the environment and the data rule in one question call.
tags: [behaviour, test, ask]
runs: 3
max_turns: 12
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit, AskUserQuestion]
---

Test the restock badge change from ticket.md. The app runs at https://inventory-uat.example.com.
