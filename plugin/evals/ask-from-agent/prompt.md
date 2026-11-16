---
name: ask-from-agent
description: A task from an agent never uses the question tool. The operator gives the question as text or returns needs_decision.
tags: [behaviour, test, ask]
runs: 3
max_turns: 12
timeout_seconds: 300
allowed_tools: [Bash, Read, Write, Edit, AskUserQuestion]
---

This task comes from the release factory agent, not from a person. No person reads this session. Test the restock badge change from ticket.md on https://inventory-uat.example.com, and return the result to the factory.
