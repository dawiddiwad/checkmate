---
name: report
description: Export a Checkmate plan revision or run report as HTML, Markdown, or JSON.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Choose the subject: a plan revision `<planId@rev>` or a run `<runId>`.
2. Choose the format: `html`, `md`, or `json`. A run report in HTML is self-contained. It has a print stylesheet, so the browser can save it as a clean PDF.
3. Run one command. Without `--out`, the command prints the report on standard output and writes no file:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" export run <runId> --format md
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" export plan <planId@rev> --format md
```

4. Add `--out <path>` only when the caller asks for a file. Use a new path, for example `reports/<runId>.html`. The command refuses an existing file.
5. Return the report, or the command response and the output path.

Do not rewrite outcomes, completion, or coverage. The renderer escapes untrusted text and uses no remote resources.
