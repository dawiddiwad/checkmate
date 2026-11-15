---
name: sandbox-probe
description: The shell of the eval can write in the workspace and open a SQLite database in WAL mode. Run this case first.
tags: [probe]
runs: 1
max_turns: 3
timeout_seconds: 120
allowed_tools: [Bash, Read, Write, Edit]
---

Run this one command in the workspace and show its output:

```sh
touch .probe && node -e "new (require('node:sqlite').DatabaseSync)('.probe.db').exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS t (x)')" && echo "WRITABLE-$((6 * 7))"
```
