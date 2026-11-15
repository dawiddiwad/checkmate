---
type: regex
pattern: 'WRITABLE-42'
target: trace
weight: 1
---

The command printed `WRITABLE-42`, so the workspace is writable and SQLite can open a WAL database. The prompt has only `$((6 * 7))`, so the prompt alone does not match.
