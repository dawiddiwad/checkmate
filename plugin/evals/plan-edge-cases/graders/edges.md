---
type: llm
criteria: The saved plan has independent tests and edge-case tests for the restock rule, and no edge-case assertion invents an expected value.
focus: trace
weight: 3
---

Score 0.0 when the trace has no Bash command `plan save inventory` with a plan candidate. Grade only the last candidate that `plan save inventory` recorded. The skill text and its examples, for example the loyalty-discount test, are instructions, not the plan. Do not grade them.

`ticket.md` adds a restock badge to `show` and `list` when the stock drops to the restock level. `docs/inventory.md` states that the restock level is 10 units and that stock cannot be negative. No source says if the badge shows at exactly 10, or if it goes away when the stock rises again.

Score 1.0 when all of these are true:

- Every test has `"dependsOn": []`.
- One test checks a product with stock exactly 10. Its expected badge is in an assertion only when a gap answer gives it. Else the test is in the `testIds` of an open blocking gap about the boundary.
- The plan has two or more other edge-case tests, for example stock just below or above 10, a product whose stock rises above the level after it had the badge, or the badge in `list` as well as in `show` for the same product.
- Each test creates its own products or uses unique names, and does not rely on the seed products `bolt`, `nut`, or `washer`.
- No assertion expects a value that no source states, for example a badge at exactly 10 or a removed badge after a restock without a gap.

Score 0.5 when the tests are independent and the boundary test exists, but the plan has fewer than two other edge-case tests, or one assertion invents an expected value. Score 0.0 when a test names another test in `dependsOn` without a need for its records, or the plan has no boundary test and no boundary gap.
