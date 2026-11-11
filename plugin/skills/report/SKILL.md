---
name: report
description: Export a Checkmate plan revision or run result as Markdown, HTML, or JSON.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Choose the subject: a plan revision `<planId@rev>` or a run `<runId>`.
2. Choose a new output path, for example `reports/<runId>.html`. The command refuses an existing file.
3. Run one command:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" export run <runId> --format html --out reports/<runId>.html
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" export plan <planId@rev> --format md --out reports/<planId>.md
```

4. Return the command response and the output path.

Do not rewrite outcomes, completion, or coverage. The renderer escapes untrusted text and uses no remote resources.
