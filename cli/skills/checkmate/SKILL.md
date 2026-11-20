---
name: checkmate
description: Set up a QA target, plan or run tests, and inspect evidence with Checkmate in Pi.
---

Use the CLI in this package. Resolve `../../src/main.ts` from the directory of this skill. If that file is absent, use `../../dist/checkmate.js`. Run each command in the project workspace as `CHECKMATE_HARNESS=pi node "<absolute CLI path>" <command>`. Keep the provider, model, credentials, and tool policy in Pi.

1. Run `target list` and `plan list`. Use an existing target or plan when it matches the request.
2. For a new target, ask for the running URL. For a remote URL, confirm the environment and permitted operations. Run `setup --url <url>`. Give the confirmed `--environment` and `--operations` for production. Record only a reference for credentials.
3. For a test plan, run `plan open <planId> --target <targetId>@<revision> --objective "<objective>" --source <file>`. Then run `delegate plan <planId>`. Show the open gaps. Ask the oracle for decisions.
4. For an exploratory test, run `test <planId> --source <file> --allow Read --allow Bash`. Add `--level smoke|normal|deep` when the person selects a level. Run `explore wait <explorationId>`, then `explore show <explorationId>`.
5. If the test starts a run of stored tests, run `delegate execute <runId>`.
6. Read `status <planId>`. Report the outcomes, evidence, gaps, and next decision. A completed command can record failed or blocked tests.
