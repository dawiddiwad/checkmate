---
type: regex
pattern: '"type":"tool_result","content":"WRITABLE-42'
target: trace
weight: 1
---

The Bash tool result starts with `WRITABLE-42`. The text of the model does not count, so the workspace is writable and SQLite can open a WAL database. The prompt has only `$((6 * 7))`, so the prompt alone does not match.
