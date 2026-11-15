---
type: regex
pattern: 'checkmate\.js[\\"]* plan save inventory.*dependsOn[\\"]*\s*:\s*\[(?:\s|\\[nt])*[\\"]*T\d'
target: trace
match: not_contains
weight: 1
---

No test of a `plan save inventory` candidate names a local test in `dependsOn`. Each test of this ticket can make its own products. The skill text does not count. Use it with `saved`, because a trace without `plan save` also passes.
