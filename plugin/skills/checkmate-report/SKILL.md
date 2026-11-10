---
name: checkmate-report
description: Generate Markdown and HTML views from a saved Checkmate result.
---

`<plugin>` is the Checkmate plugin root: the directory two levels above this `SKILL.md`. Use its absolute path in commands.

Read `<plugin>/references/workflow.md`.
Read `<plugin>/contracts/report-request.schema.json`.

Read the request. Run:

```sh
node "<plugin>/bin/checkmate.ts" report request.json
```

Return the command response. Do not rewrite verdicts or coverage. The renderer escapes untrusted text and uses no remote resources.
