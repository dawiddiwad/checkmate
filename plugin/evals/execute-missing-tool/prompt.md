---
name: execute-missing-tool
description: One test needs a tool that is missing. QA closes it, runs the other tests, and ends with run finish.
tags: [behaviour, execute]
runs: 3
max_turns: 60
timeout_seconds: 900
allowed_tools: [Bash, Read]
---

Execute the Checkmate run run-1 in this workspace. The run is already begun. Work without asking me questions.
