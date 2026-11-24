---
name: report
description: Export a Checkmate plan revision or run report as HTML, Markdown, or JSON, or a run as JUnit XML.
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Read `${CLAUDE_PLUGIN_ROOT}/references/workflow.md` for the command rules and `${CLAUDE_PLUGIN_ROOT}/references/session.md` for the report format.

The plugin CLI is `${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js`. Run `checkmate <command>` as `CHECKMATE_HOST_SESSION=1 node "${CLAUDE_PLUGIN_ROOT}/dist/checkmate.js" <command>`. Write the absolute path. Do not write a shell variable in its place.

1. Choose the subject: a plan revision `<planId@rev>`, a run `<runId>`, or an exploration `<explorationId>`. When the oracle does not name it, run `checkmate run list` or `checkmate plan list`. When more than one subject fits, ask which one, as Ask the person says.
2. Choose the format: `html`, `md`, or `json`. For a CI system or a test management tool, use `junit` for a run. A run report needs a finished run. A run report in HTML is self-contained. It has a print stylesheet, so the browser can save it as a clean PDF.
3. Run one command. Without `--out`, the command prints the report on standard output and writes no file:

```sh
checkmate export run <runId> --format md
checkmate export plan <planId@rev> --format md
checkmate export exploration <explorationId> --format md
```

An exploration report has `md` and `json` formats only.

4. Add `--out <path>` only when the oracle asks for a file. Use a new path, for example `reports/<runId>.html`. The command refuses an existing file.
5. Without `--out`, print the full report to the oracle as the command prints it. Do not summarize it, shorten it, or reorder it.
6. With `--out`, give the command response and the output path.
7. When you add a table or a sentence of your own, copy each ID and title exactly from the report or the database. Do not rename, renumber, or translate them.

A JSON run report has `result`, `sha256`, `acceptance`, `planApproval`, and `plan`. `acceptance.latest` and `planApproval.latest` name the actor and the time of the latest verdict.

The review UI gives the same exports: `Download report` on the run page, and `Export` on the plan page.

Do not rewrite outcomes, completion, or coverage. The renderer escapes untrusted text and uses no remote resources.

## Ask the person

When you need a decision from the person, the choices are few, and the `AskUserQuestion` tool is in your tool list, ask with that tool. Use one call with at most 4 questions and 2 to 4 options for each question. Put the recommended option first, and add "(Recommended)" to its label. Give each question a header of at most 12 characters. Give each option one line that says what happens. Do not add an "Other" option. The tool adds it.

When the tool is not in your tool list, or your task came from an agent, a factory, or a script, do not use the tool. Write the question and its options in your reply as a short numbered list, or return `needs_decision` with the reason. An agent that is the oracle can answer in text.

For a value with no fixed choices, for example a URL or how to sign in, ask one short text question. Do not ask for a secret. Ask where it is kept.
