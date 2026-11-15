---
type: regex
pattern: 'checkmate\.js[\\"]* run begin run-\d+ stock@1 (?=.*--build b2)(?=.*--retest-of run-1)'
target: trace
weight: 1
---

The agent runs `run begin` with a real run ID, `--build b2`, and `--retest-of run-1`. The `<runId>` hint of `status` does not count.
