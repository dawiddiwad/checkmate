---
name: report
description: Export a Checkmate plan revision or run result as Markdown, HTML, or JSON.
---

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`.

1. Read the requested subject with `checkmate plan show <planId@rev> --json` or `checkmate run show <runId> --json`. Read the current approval or acceptance decision and its rationale. Use `approval.latest` for a plan and `result.latestDecision` for a run; the command's `reasons` array is not the caller's rationale. If rejected, include that rationale and the required next decision in the summary. A summary request does not authorize a rerun. If the caller asks only for a summary, present the current result and stop. Continue below only when the caller asks for a file.
2. Choose a new output path, for example `reports/<runId>.html`. The command refuses an existing file.
3. Run one command:

```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" export run <runId> --format html --out reports/<runId>.html
node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" export plan <planId@rev> --format md --out reports/<planId>.md
```

4. Return the command response and the output path.

Do not rewrite outcomes, completion, or coverage. The renderer escapes untrusted text and uses no remote resources.
