# Examples

These files were exported from a live run with Claude Code on the local checkout fixture (`test/fixture.ts`). The run is `npm run test:live` on 11 November 2026 with `ANTHROPIC_MODEL=claude-haiku-5-5`. [Validation](../VALIDATION.md#live-run) records the stages and durations.

The text in the plans and results is the text that Claude and the test caller wrote. It is not edited.

The current exporter rendered the files again from the stored plan and result snapshots of that run. After the live run, the assertion field `oracleKind` became `checkKind`. The snapshots use the new name, so the plan and result digests are new: each digest is the SHA-256 of the canonical JSON in its file, and a run refers to the new plan digest. The target profile is not in the exports, so its digest stays as recorded. The live database was not kept, so two details come from other records:

- The acceptance of `live-run` uses the actor and rationale of `test/live.ts` (`acceptance-test`, `The defect is real.`). Its time is known to the minute only.
- The HTTP evidence is inline because its bytes were recovered: each text has the recorded SHA-256 digest. The text evidence of T1 was not recovered, so the report lists it without content.

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

In both runs, R3 (refunds) stays uncovered, because its gap is deferred. Completion is `completed` and coverage is `partial`. These are separate fields. Checkmate recorded these results before the requirement status `deferred` existed. A new run records R3 as `deferred`, because only a caller decision leaves it open.

## Notes

- The evidence bytes stay in the database. The reports list each evidence item with its name, media type, size, and SHA-256 digest. Read the bytes with `checkmate evidence get <evidenceId> --out <file>`.
- A JSON run report is `{ "result", "sha256", "acceptance", "plan" }`. A JSON plan export is the stored plan revision.
- The exports contain no credentials and no local paths. The fixture URL is in the target profile, which the exports do not include.
- `.prettierignore` excludes this directory, so the files keep the exact bytes of the export.

To make the same files from your own database:

```sh
checkmate export plan checkout@2 --format md --out docs/examples/plans/checkout-v2.md
checkmate export run live-run --format html --out docs/examples/runs/live-run.html
checkmate export run live-run --format json > docs/examples/runs/live-run.json
```
