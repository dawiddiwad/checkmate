---
type: regex
pattern: 'checkmate\.js[\\"]* (run begin|run finish|result accept|gap answer)'
target: trace
match: not_contains
weight: 1
---

A status question changes no record.
