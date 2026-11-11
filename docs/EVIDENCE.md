# Evidence and outcomes

This page describes how Checkmate records assertion results, derives test outcomes, stores evidence, and reports a run.

## Assertions

A test has one action and a list of assertions. An assertion is one thing that the agent must check, for example `totalPLN equals 240.` Each assertion has an ID, a `check`, and an `oracleKind`:

- `deterministic`: the check compares an exact value.
- `agent_observation`: the agent interprets the evidence, for example a page layout.

The plan sets the check text and the oracle kind. The agent does not send them during a run. Checkmate copies them from the plan revision into the result.

## Assertion results

The agent records each assertion once. Set `EVIDENCE_DIRECTORY` to the absolute `evidenceDirectory` returned by `run begin`, `run resume`, or `run show --json`:

```sh
checkmate run check run-1 T2 A1 --result failed \
  --observed "GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 220." \
  --evidence "$EVIDENCE_DIRECTORY/T2-A1.json"
```

| Result         | Meaning                                                                        | Needs                                              |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| `passed`       | The agent observed the target. The observation meets the check.                | `--observed`, one or more `--evidence`             |
| `failed`       | The agent observed the target. The observation contradicts the check.          | `--observed`, one or more `--evidence`             |
| `inconclusive` | The agent checked the assertion. The evidence cannot show if the check is met. | `--observed`, one or more `--evidence`, `--reason` |
| `not_checked`  | The agent did not check the assertion.                                         | `--reason`                                         |

Checkmate also checks these rules when it records a result:

- The run is started and not finished.
- The test is selected in the run, and it is not closed.
- The assertion exists in the test, and it has no result. An assertion result is final.
- Each local prerequisite in `dependsOn` is closed as `passed`.

After a failed assertion, the agent checks the assertions that it can still check. It records the others as `not_checked`.

## Test outcome

When each assertion of a test has a result, the agent runs `checkmate run close <runId> <testId>`. Checkmate derives the outcome. The agent does not set it.

Checkmate uses the first row that applies:

| Assertion results          | Test outcome   |
| -------------------------- | -------------- |
| One or more `failed`       | `failed`       |
| One or more `not_checked`  | `error`        |
| One or more `inconclusive` | `inconclusive` |
| All `passed`               | `passed`       |

- `failed` comes first. One failed assertion fails the test, whatever the other results are.
- `error` comes before `inconclusive`. An assertion that was not checked means that the run is incomplete for that test. The caller must know this first. The reason names the unchecked assertions.
- A test that the agent did not start has no assertion results. The agent closes it with `--outcome blocked`, `--outcome not_run`, or `--outcome error`, and a `--reason`.
- A tool failure during a test is `--outcome error`. The assertion results that the agent recorded before the failure stay. Evidence for the whole test, for example an error screenshot, can go with `--outcome error`.
- A test outcome is final. A second `close` fails.
- `run finish` records each selected test that is not closed as `error`, with the reason `Run stopped before the test closed. Actions may have occurred.` It records each unselected test as `not_run`.

### Inconclusive

- `inconclusive` is not a defect. It needs no finding. The agent can add a `potential_issue` finding when it suspects a defect.
- An inconclusive test does not cover its requirements. The requirement stays `uncovered` with the reason `An assertion is inconclusive.`
- An inconclusive test does not prevent `completion: completed`. The check ran. Only the evidence was not sufficient.
- An inconclusive test does not satisfy a dependency. A dependency needs `passed`.
- The caller decides what to do next: a decision that gives a stronger oracle, a change to the assertion, or a retest with better evidence. The review UI lists each inconclusive assertion with its reason above the result decision.

## Evidence capture

1. `run begin`, `run resume`, or `run show --json` returns an absolute `evidenceDirectory` in the operating system's temporary area. Use that returned path; do not construct a path under `.checkmate/`.
2. If a tool needs a file, capture the observation in that directory, for example `$EVIDENCE_DIRECTORY/T2-A1.json`.
3. Give its path with `--evidence <path>[:kind]`. A command can take more than one `--evidence`.
4. Checkmate reads the bytes and stores them with the evidence record in the same database transaction as the result.
5. After a successful commit, Checkmate removes the capture file. A refused command keeps it for retry. Finishing the run removes remaining captures.

Evidence files are temporary tool inputs, not run records. Checkmate does not write a local JSON snapshot for each run. The database holds all durable evidence, including screenshots and traces. Temporary files may remain after an interruption until the run finishes. Existing pending captures from older `.checkmate/tmp/<runId>/` directories can still be imported; successful imports remove them. New runs do not create those directories.

Checkmate refuses evidence outside the run's temporary capture directory after symbolic links are resolved, non-regular files, and files larger than 32 MiB. The limit applies to each file. `node:sqlite` reads and writes a BLOB as one buffer.

The kind is `observation`, `http_exchange`, `screenshot`, or `trace`. Without `:kind`, the extension sets it: `.png`, `.jpg`, `.jpeg`, and `.webp` are `screenshot`, `.json` is `http_exchange`, `.zip` and `.trace` are `trace`, and other files are `observation`. The extension also sets the media type. An unknown extension gives `application/octet-stream`.

### Blobs

- Evidence bytes are BLOBs in the `blobs` table. The key is the SHA-256 digest of the bytes. Equal files are stored once.
- Each evidence row has a ULID, the run, the test, the assertion (or none for evidence of the whole test), the kind, the original file name, the media type, and the digest.
- Rows do not change after a write. A stored digest matches the stored bytes.
- `checkmate evidence get <evidenceId> --out <file>` writes the bytes to a new file. The bytes are equal to the input bytes.
- The review UI serves the bytes with the stored media type. It shows images and plain text inline. It sends other types as a download.

## Findings

`checkmate run finding <runId>` records a finding from JSON on standard input. Use a pipe or here-document instead of keeping a generated JSON file. Read [Configuration](CONFIGURATION.md#finding) for the payload.

- `defect`: a product defect. It names one or more failed assertions, and only failed assertions.
- `potential_issue`: a suspicion, for example with an inconclusive assertion. It can name any assertion of a selected test.
- Each failed assertion needs a defect finding. `run finish` refuses the run without it.
- The requirements of a finding must be requirements of the named tests.
- The evidence of a finding must belong to the named assertions, or to their tests as a whole.
- Checkmate adds the `testIds` from the named assertions.

A tool or access failure is an `error` outcome. It is not a product defect. Keep requirement gaps separate from findings. Record new ambiguity with `checkmate run gap`.

## Completion, outcomes, and coverage

These are three separate fields. Do not combine them.

| Field        | Values                                                            | Describes                                   |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| `completion` | `completed`, `interrupted`, `operational_error`                   | The operation: did the run finish its work? |
| `outcome`    | `passed`, `failed`, `inconclusive`, `blocked`, `not_run`, `error` | One test.                                   |
| `coverage`   | `complete`, `partial`, `not_executed`                             | The full requirement inventory of the plan. |

`run finish --completion completed` needs:

- every selected test closed, and no selected test closed as `error`,
- a cleanup status that is not `failed`,
- a cause for each selected test that is `blocked` or `not_run`: a prerequisite that did not pass, a blocked cross-plan dependency, or a new blocking gap,
- a defect finding for each failed assertion.

A requirement is `tested` when it has one or more planned tests, no deferred or open blocking gap applies to it, and each of its tests is `passed` or `failed`. Else it is `uncovered` with a reason. Coverage is `complete` when every requirement is tested. It is `partial` when one or more tests ran. Else it is `not_executed`. A narrow retest keeps the requirements of unselected tests uncovered.

A `completed` run with failed tests is a correct result. The process exit code of `run finish` is 0 for `completed` and 1 for `interrupted` or `operational_error`. An exit code is not a release decision. Result acceptance is a caller record. It is not a release decision by Checkmate.

## Resume

A crash or a deadline does not finalize a run. The run stays `started`, and recorded results stay.

- `checkmate run resume <runId>` records a new attempt. It lists each selected test that is not closed, with the assertions that have no result.
- Checkmate does not repeat a test automatically. A test that was open when the session stopped shows the warning `Actions may have occurred`. The caller decides to continue it or to close it as `error`.
- `checkmate run resume <runId> --error T3,T4 --reason <text>` closes the named tests as `error` and records the new attempt in one step.

## Export

```sh
checkmate export run run-1 --format html --out reports/run-1.html
checkmate export plan checkout@2 --format md --out reports/checkout-v2.md
```

- `--format` is `md`, `html`, or `json`. `json` prints the stored snapshot.
- `export run` needs a finished run. `export plan` needs a revision reference or a plan ID for the latest revision.
- The command refuses an existing output file.
- A finished run in the UI has Download HTML and Download JSON buttons. Print / Save PDF opens the browser print dialog. The browser creates the PDF; Checkmate does not use a PDF service.
- A run report shows the summary, each test outcome, each assertion with its check, observation, reason, and evidence, the findings with reproduction steps, new gaps, evidence digests, coverage for each requirement, and cleanup. The complete JSON record follows in a collapsed section.
- A plan view shows the requirements and coverage, tests and readiness, assertions, gaps, decisions, and assumptions.
- The renderer escapes untrusted text for Markdown and HTML. The HTML has a Content Security Policy that blocks scripts and remote resources.
- An export is a view. The database is the authority. Do not edit an export to change a verdict.

[docs/examples](examples/README.md) contains exports from a live run.

## Retention and limits

- Checkmate does not sanitize evidence. Screenshots and text are stored as the agent wrote them.
- Do not capture credentials, cookies, authorization headers, or full raw transcripts.
- The caller owns access to the database and how long it keeps evidence. Rows cannot be deleted through Checkmate. To remove evidence, delete the database file or keep a new one for each retention period.
- Use a trusted local workspace. Path checks are not a filesystem sandbox. They do not protect against an actor who can replace files at the same time.
- Checkmate validates structure and relationships. A digest shows that bytes did not change after the write. It does not show that an observation is true, that the evidence came from the target, or that the agent interpreted it correctly.
