# Runs and evidence

> **Reference** · How a run records assertion results and evidence, how Checkmate derives outcomes and coverage, and how a report is made.

QA records one result for each assertion, and Checkmate derives each test outcome from those results. Completion, test outcomes, and coverage are three separate fields, so a finished run with failed tests is a correct result.

<img src="../img/run.png" alt="Diagram: the record of run-1 on plan checkout@2, build b1, with tests T1 and T2. T1, Standard total, passed: its assertion T1.A1, Total is 400 PLN, passed with evidence T1-A1.json and its sha256. T2, Promotion, failed: its assertion T2.A1, totalPLN equals 240, failed with the observation totalPLN 220 and evidence T2-A1.json. Defect F1 names T2.A1 and its evidence. The run can also record new gaps for the oracle. On the right, four separate answers: completion is completed, outcome is passed 1 and failed 1, coverage is complete, and the oracle's acceptance is accepted. Each assertion result is final, and Checkmate derives the test outcome from the assertion results." width="100%"/>

**On this page:** [Run commands](#run-commands) · [Assertion results](#assertion-results) · [Test outcomes](#test-outcomes) · [Evidence input](#evidence-input) · [Findings](#findings) · [Completion and coverage](#completion-and-coverage) · [Resume](#resume) · [Export](#export) · [Retention](#retention)

## Run commands

A run goes through these commands in order:

1. `run begin <runId> <planId@rev> --build <build>` checks the gate and starts the run. It prints the browser session and the evidence directory `.checkmate/tmp/<runId>/`.
2. `run check <runId> <testId> <assertionId> --result <result>` records one assertion result with its evidence.
3. `run close <runId> <testId>` closes a test. Checkmate derives the outcome.
4. `run finding <runId>` and `run gap <runId>` record findings and new gaps from standard input.
5. `run finish <runId> --completion <completion> --cleanup <completed|failed|not_applicable> --cleanup-reason <text>` checks the run and stores the result.

A run is `started` until `run finish`. After `run finish`, the run does not change. The flags of `run begin` are in [Commands](commands.md#run-gate-and-policy).

## Assertion results

QA records each assertion once:

```sh
checkmate run check run-1 T2 A1 --result failed \
  --observed "GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 220." \
  --evidence -:http_exchange <<'EOF'
{"method":"GET","path":"/quote","status":200,"totalPLN":220}
EOF
```

```text
completed run-1 T2.A1=failed
01M7CVS2BYAKYGP315N5CCF63S	evidence
```

| Result         | Meaning                                                                 | Needs                                              |
| -------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `passed`       | QA observed the target. The observation meets the check.                | `--observed`, one or more `--evidence`             |
| `failed`       | QA observed the target. The observation contradicts the check.          | `--observed`, one or more `--evidence`             |
| `inconclusive` | QA checked the assertion. The evidence cannot show if the check is met. | `--observed`, one or more `--evidence`, `--reason` |
| `not_checked`  | QA did not check the assertion.                                         | `--reason`                                         |

- The run is started, and the test is selected and not closed.
- The assertion exists and has no result. A result is final.
- Each local prerequisite in `dependsOn` is closed as `passed`.
- The check text and the check kind come from the plan. QA does not send them.
- After a failed assertion, QA checks the assertions that it can still check, and records the others as `not_checked`.

## Test outcomes

`run close <runId> <testId>` derives the outcome from the first row that applies:

| Assertion results          | Test outcome   |
| -------------------------- | -------------- |
| One or more `failed`       | `failed`       |
| One or more `not_checked`  | `error`        |
| One or more `inconclusive` | `inconclusive` |
| All `passed`               | `passed`       |

- One failed assertion fails the test.
- `error` comes before `inconclusive`, because an unchecked assertion means the run is incomplete for that test.
- A test that QA did not start has no results. Close it with `--outcome blocked`, `not_run`, or `error`, and a `--reason`.
- A tool failure during a test is `--outcome error`. The results recorded before the failure stay. Evidence for the whole test can go with it.
- An outcome is final.

### Inconclusive

- It is not a defect and needs no finding. QA can add a `potential_issue` finding.
- It does not cover its requirements. The requirement stays `uncovered`.
- It does not prevent `completion: completed`.
- It does not satisfy a dependency. A dependency needs `passed`.
- The oracle decides what comes next: a more exact answer, a changed assertion, or a retest with better evidence.

## Evidence input

`run check` and `run close` take one or more `--evidence` options. The database is the only record. No evidence file stays in the workspace.

### Text

Send text on standard input with `--evidence -`. Do not write a file.

- Valid JSON is stored as `application/json` with the name `<testId>-<assertionId>.json`. Other text is `text/plain` with the name `<testId>-<assertionId>.txt`.
- The kind is `observation`. Use `--evidence -:<kind>` for another kind, for example `-:http_exchange`.
- A command takes one non-empty text.

### Binary files

Use a file only for binary evidence, for example a screenshot.

1. Write one new file in the evidence directory, for example `.checkmate/tmp/run-1/T1-A1.png`.
2. Give its path, relative to the workspace: `--evidence <path>[:kind]`.
3. Checkmate stores the bytes and the evidence row in the same transaction as the result.
4. After the commit, Checkmate deletes the file. A refused command keeps it, so QA can send it again.
5. `run finish` removes `.checkmate/tmp/<runId>/` with its contents.

Checkmate refuses a path that is absolute, is outside `.checkmate/tmp/<runId>/` after symbolic links are resolved, is not a regular file, or is larger than 32 MiB. The same limit applies to a text.

The kind is `observation`, `http_exchange`, `screenshot`, or `trace`. Without `:kind`, the extension sets it: `.png`, `.jpg`, `.jpeg`, and `.webp` are `screenshot`, `.json` is `http_exchange`, `.zip` and `.trace` are `trace`, and other files are `observation`. An unknown extension gives the media type `application/octet-stream`.

A command can take one text and one or more files together.

### Read evidence back

`checkmate evidence get <evidenceId> --out <file>` writes the stored bytes to a new file. The review UI shows images and plain text inline, and sends other types as a download.

## Findings

- `defect`: a product defect. It names one or more failed assertions, and only failed assertions.
- `potential_issue`: a suspicion. It can name any assertion of a selected test.
- Each failed assertion needs a defect. `run finish` refuses the run without it.
- The requirements of a finding belong to the named tests.
- The evidence of a finding belongs to the named assertions, or to their tests.

A tool or access failure is an `error` outcome, not a defect. New ambiguity is a gap: record it with `run gap`. The payloads are in [Payloads](payloads.md#finding).

## Completion and coverage

| Field        | Values                                                            | Describes                                   |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| `completion` | `completed`, `interrupted`, `operational_error`                   | The operation: did the run finish its work? |
| `outcome`    | `passed`, `failed`, `inconclusive`, `blocked`, `not_run`, `error` | One test.                                   |
| `coverage`   | `complete`, `partial`, `not_executed`                             | The requirements of the plan.               |

`run finish --completion completed` needs:

- every selected test closed, and none closed as `error`,
- a cleanup status that is not `failed`,
- a cause for each `blocked` or `not_run` test: a prerequisite that did not pass, a blocked cross-plan dependency, or a new blocking gap,
- a defect for each failed assertion.

`run finish` closes each open selected test as `error` with the reason `Run stopped before the test closed. Actions may have occurred.` It records each unselected test as `not_run`.

Each requirement gets one coverage status:

| Status      | When                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tested`    | It has planned tests, no open or deferred blocking gap applies to it, and each of its tests is `passed` or `failed`.                                |
| `deferred`  | Only an oracle decision leaves it open: a deferred blocking gap applies, no open blocking gap applies, and each other test is `passed` or `failed`. |
| `uncovered` | Any other case. The reason says why.                                                                                                                |

- Coverage is `complete` when every requirement is `tested`, `partial` when one or more tests ran, and else `not_executed`.
- Outcome counts count only the selected tests. Coverage still lists every requirement of the plan.
- A narrow retest keeps the requirements of unselected tests uncovered.
- A deferred non-blocking gap does not change coverage.

The exit code of `run finish` is 0 for `completed` and 1 for `interrupted` or `operational_error`. An exit code is not a release decision. Neither is result acceptance by the oracle.

## Resume

A crash or a deadline does not finish a run. The run stays `started`, and the recorded results stay.

- `run resume <runId>` records a new attempt. It lists each open test with the assertions that have no result.
- Checkmate does not repeat a test. A test that was open when the session stopped shows `Actions may have occurred`. The oracle decides to continue it or to close it as `error`.
- `run resume <runId> --error T3,T4 --reason <text>` closes those tests as `error` and records the new attempt in one step.

## Export

```sh
checkmate export run run-1 --format md
checkmate export run run-1 --format html --out reports/run-1.html
checkmate export plan checkout@2 --format json
```

- `--format` is `md`, `html`, or `json`. Without `--out`, the report goes to standard output. `--out` refuses an existing file.
- `export run` needs a finished run. `export plan` takes a revision reference, or a plan ID for the latest revision.
- A run report shows the summary, the acceptance, each outcome, each assertion with its check, observation, and evidence, the findings, the new gaps, coverage, and cleanup. The full JSON record follows in a folded section.
- The HTML report is one self-contained file. It shows small images and text evidence inline. It has a print stylesheet, so a browser can save it as a PDF.
- The JSON run report is `{ "result", "sha256", "acceptance", "plan" }`. A JSON plan export is the stored plan revision.
- The renderer escapes untrusted text. The HTML has a Content Security Policy that blocks scripts and remote resources.
- An export is a view. The database is the authority. Do not edit an export to change a verdict.

The review UI offers the same exports. [Examples](../examples/README.md) has exports from a live run.

## Retention

- Checkmate does not sanitize evidence. It stores what QA sent.
- Do not capture credentials, cookies, authorization headers, or full raw transcripts.
- The workspace owner owns access to the database and how long it keeps evidence. Checkmate cannot delete rows. To remove evidence, delete the database file, or start a new one for each retention period.
- A digest shows that the bytes did not change after the write. [Limits](record.md#limits) lists what the checks do not show.

## Next

- [The record](record.md): how the database stores runs and evidence.
- [Decide as the oracle](../guides/oracle.md#accept-a-result): accept or reject a result.
