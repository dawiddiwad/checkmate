---
type: regex
pattern: 'checkmate\.js[\\"]* run (close|finish) run-1 .*--cause deadline'
target: trace
match: not_contains
weight: 1
---

No `run close` or `run finish` command of the agent gives `--cause deadline`. The skill text does not count.
