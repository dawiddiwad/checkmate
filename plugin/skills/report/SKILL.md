---
name: report
description: Export a Checkmate plan revision or run report as HTML, Markdown, or JSON.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`. It has the command rules and the report format.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

1. Choose the subject: a plan revision `<planId@rev>` or a run `<runId>`. When the caller does not name it, run `checkmate run list` or `checkmate plan list` and ask.
2. Choose the format: `html`, `md`, or `json`. A run report needs a finished run. A run report in HTML is self-contained. It has a print stylesheet, so the browser can save it as a clean PDF.
3. Run one command. Without `--out`, the command prints the report on standard output and writes no file:

```sh
checkmate export run <runId> --format md
checkmate export plan <planId@rev> --format md
```

4. Add `--out <path>` only when the caller asks for a file. Use a new path, for example `reports/<runId>.html`. The command refuses an existing file.
5. Without `--out`, print the full report to the caller as the command prints it. Do not summarize it, shorten it, or reorder it.
6. With `--out`, give the command response and the output path.
7. When you add a table or a sentence of your own, copy each ID and title exactly from the report or the database. Do not rename, renumber, or translate them.

A JSON run report has `result`, `sha256`, `acceptance`, and `plan`.

The review UI gives the same exports: `Download report` on the run page, and `Export` on the plan page.

Do not rewrite outcomes, completion, or coverage. The renderer escapes untrusted text and uses no remote resources.
