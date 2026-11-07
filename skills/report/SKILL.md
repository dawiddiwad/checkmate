---
name: report
description: Generate Markdown and HTML views from a saved Checkmate result.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.
Read `contracts/report-request.schema.json` in the plugin.

Read the request. Run:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/checkmate.ts" report request.json
```

Return the command response. Do not rewrite verdicts or coverage. The renderer escapes untrusted text and uses no remote resources.
