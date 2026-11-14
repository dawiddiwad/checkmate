# Examples

> **Reference** · Plans and runs exported from a live run with Claude Code, and what that run showed.

These files are real exports. Claude wrote the plans and results, and the test oracle made the decisions, on the local checkout fixture in `test/fixture.ts`.

## Plans

| Revision | Markdown                               | JSON                                       | Content                                                                                  |
| -------- | -------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1        | [checkout-v1.md](plans/checkout-v1.md) | [checkout-v1.json](plans/checkout-v1.json) | Four tests. Two open blocking gaps: promotion stacking (T3) and refund eligibility (T4). |
| 2        | [checkout-v2.md](plans/checkout-v2.md) | [checkout-v2.json](plans/checkout-v2.json) | G1 is clarified, and T3 has an assertion. G2 is deferred, and T4 is deferred.            |

## Runs

| Run           | Markdown                              | HTML                                      | JSON                                      | Content                                                                                             |
| ------------- | ------------------------------------- | ----------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `live-run`    | [live-run.md](runs/live-run.md)       | [live-run.html](runs/live-run.html)       | [live-run.json](runs/live-run.json)       | Build `fixture-build-1`. T1 and T2 passed. T3 failed with defect F1. Coverage is partial. Accepted. |
| `live-retest` | [live-retest.md](runs/live-retest.md) | [live-retest.html](runs/live-retest.html) | [live-retest.json](runs/live-retest.json) | Build `fixture-build-2`, a retest of `live-run`. T2 and T3 passed. Acceptance is pending.           |

In both runs, R3 (refunds) stays uncovered, because its gap is deferred. These results were recorded before the requirement status `deferred` existed. A new run records R3 as `deferred`. These results were also recorded before instances existed. A new result records `instanceId`, and its summary shows the instance.

## The live run

`npm run test:live` passed on 11 November 2026 on Linux with Node.js `v24.22.2`, Claude Code `2.1.319`, Playwright CLI `0.1.23`, and `ANTHROPIC_MODEL=claude-haiku-5-5`. The workers had `Read`, `Write`, `Edit`, and `Bash` in a temporary workspace.

| Stage             | Seconds | Status           |
| ----------------- | ------: | ---------------- |
| Setup             |    16.3 | `completed`      |
| Plan              |    23.3 | `needs_decision` |
| Revise            |    17.6 | `completed`      |
| Execute           |    48.5 | `completed`      |
| Retest            |    48.7 | `completed`      |
| Same-session plan |    35.5 | `needs_decision` |

What the run showed:

- Setup saved the profile `checkout-local@1` with the actual tool versions.
- The plan had two blocking gaps. The first `plan save` was refused, and the worker corrected the candidate. Planning did not run a fixture action.
- The oracle clarified the promotion rule and deferred refunds. Revise added the assertion to T3. The oracle approved `checkout@2`.
- Execute found the seeded defect: the quote returned 220 PLN instead of 240 PLN. The oracle accepted the result.
- After the fixture changed, a retest on a new build passed T2 and T3. The first run did not change.

These values describe one run. They are not performance targets. The model, the load, and tool latency can change them.

## How the files were made

The current exporter rendered the files again from the stored snapshots of that run. After the run, the assertion field `oracleKind` became `checkKind`, so the plan and result digests are new. Each digest is the SHA-256 of the canonical JSON in its file. The target profile is not in the exports, so its digest stays as recorded.

The live database was not kept, so two details come from other records:

- The acceptance of `live-run` uses the actor and rationale of `test/live.ts`. Its time is known to the minute only.
- The HTTP evidence is inline because its bytes were recovered with the recorded digests. The text evidence of T1 was not recovered, so the report lists it without content.

The evidence bytes stay in the database. The exports contain no credentials and no local paths. `.prettierignore` excludes this directory, so the files keep the exact bytes of the export.

To make the same files from your own database:

```sh
checkmate export plan checkout@2 --format md --out docs/examples/plans/checkout-v2.md
checkmate export run live-run --format html --out docs/examples/runs/live-run.html
checkmate export run live-run --format json > docs/examples/runs/live-run.json
```

## Next

- [Runs and evidence](../reference/runs.md#export): what each report contains.
- [Development](../development.md#live-tests): run the live tests yourself.
