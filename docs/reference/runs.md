# Runs and evidence

> **Reference** · How a run records assertion results and evidence, how Checkmate derives outcomes and coverage, and how a report is made.

QA records one result for each assertion, and Checkmate derives each test outcome from those results. Completion, test outcomes, and coverage are three separate fields, so a finished run with failed tests is a correct result.

<img src="../img/run.png" alt="Diagram: the record of run-1 on plan checkout@2, build b1, with tests T1 and T2. T1, Standard total, passed: its assertion T1.A1, Total is 400 PLN, passed with evidence T1-A1.json and its sha256. T2, Promotion, failed: its assertion T2.A1, totalPLN equals 240, failed with the observation totalPLN 220 and evidence T2-A1.json. Defect F1 names T2.A1 and its evidence. The run can also record new gaps for the oracle. On the right, four separate answers: completion is completed, outcome is passed 1 and failed 1, coverage is complete, and the oracle's acceptance is accepted. Each assertion result is final, and Checkmate derives the test outcome from the assertion results." width="100%"/>

**On this page:** [Run commands](#run-commands) · [Deadline](#deadline) · [Instances and matrix runs](#instances-and-matrix-runs) · [Assertion results](#assertion-results) · [Test outcomes](#test-outcomes) · [Evidence input](#evidence-input) · [Findings](#findings) · [Completion and coverage](#completion-and-coverage) · [Resume](#resume) · [Export](#export) · [Retention](#retention)

## Run commands

A run goes through these commands in order:

1. `run begin <runId> <planId@rev> --build <build> --instance <instanceId>` checks the gate and starts the run on one instance. It prints the instance, the browser session, the deadline in UTC, and the evidence directory `.checkmate/tmp/<runId>/`. You can leave out `--instance` only when the target has one active instance.
2. `run check <runId> <testId> <assertionId> --result <result>` records one assertion result with its evidence.
3. `run close <runId> <testId>` closes a test. Checkmate derives the outcome.
4. `run finding <runId>` and `run gap <runId>` record findings and new gaps from standard input.
5. `run finish <runId> --completion <completion> [--cause <cause> --reason <text>] --cleanup <completed|failed|not_applicable> --cleanup-reason <text>` checks the run and stores the result.

A run is `started` until `run finish`. After `run finish`, the run does not change. The flags of `run begin` are in [Commands](commands.md#run-gate-and-policy).

## Deadline

A run has a deadline: `--timeout` of `run begin`, 600 seconds by default. The deadline counts from the start of the current attempt. `run resume` starts a new attempt, so the clock starts again.

`run show <runId>` prints the clock on a `time` line. Use `run show <runId> --tests <testId>` for a short output.

```text
time	deadline=2026-11-15T10:10:00.000Z	elapsed=63s	remaining=537s
```

- `run begin` and `run resume` print `deadline=` in UTC. `delegate execute` puts the deadline and the remaining seconds in the prompt, and stops the worker when they run out.
- A close or a finish for the deadline names it with `--cause deadline`: `run close --outcome blocked|not_run --cause deadline`, or `run finish --completion interrupted --cause deadline`. Checkmate refuses `--cause deadline` while less than 90% of the deadline is used. The reason of the refusal gives the share, for example `Only 12% of the deadline is used: 12 of 100 seconds, 88 remain until <deadline>. Continue the remaining tests.`
- Checkmate does not read the `--reason` text. Only `--cause deadline` is checked against the clock.
- `run show` prints `cause=deadline` on the line of a test that has the cause. The result records it as `cause` of the test. The exports show it with the reason.
- The clock of a finished run stops at `finishedAt`.

## Instances and matrix runs

A run uses one instance of the target. `run show`, `run list`, `status`, the review UI, and the exports show it. The result records `instanceId`.

- QA reads the entry values with `checkmate target show <targetId> --instance <instanceId>`.
- QA uses a `url` entry and a `value` entry as they are.
- QA runs a `command` entry at test time, for example to get a one-time login URL. Checkmate stores the command, not its output.
- A retired instance cannot start a run.
- A retest needs the same plan and target and a new build. It can run on another instance. It can keep the build only on a new instance after the instance of the earlier run is retired.
- A cross-plan dependency needs a passed result on the same build. A run on any instance counts.
- A matrix is one run of the same plan revision for each instance. `checkmate status <planId>` prints a `started` line for each open run, with its instance. On one build, each instance has its own latest outcome. A pass on one instance does not hide a failure on another instance.
- A refreshed sandbox is a new instance. Retire the old instance, add the new one, and retest on it. The retest can use the same build. The plan and the retest chain stay the same.

This example uses a Salesforce sandbox. The `web` entry is a command that prints a one-time login URL. The `org` entry is the org alias.

```sh
checkmate target open crm --entry-point "web:command:One-time login URL of the org." \
  --entry-point "org:value:Org alias for sf commands." --capabilities browser \
  --operations read_account,create_case --tool "playwright-cli:cli:Drive the browser." --tool "sf:cli:Open the org."
checkmate target instance add crm uat --entry "web=sf org open --target-org crm-uat --url-only --json" \
  --entry org=crm-uat --environment "UAT sandbox" --reference "sf alias crm-uat"
checkmate target instance add crm qa --entry "web=sf org open --target-org crm-qa --url-only --json" \
  --entry org=crm-qa --environment "QA sandbox"
checkmate run begin run-uat cases@1 --build 2026.11.14 --instance uat --partial ready_only
checkmate run begin run-qa cases@1 --build 2026.11.14 --instance qa --partial ready_only
```

After a sandbox refresh:

```sh
checkmate target instance retire crm uat
checkmate target instance add crm uat-2 --entry "web=sf org open --target-org crm-uat --url-only --json" \
  --entry org=crm-uat --environment "UAT sandbox, refreshed"
checkmate run begin run-uat-2 cases@1 --build 2026.11.15 --instance uat-2 --tests T1,T2 --retest-of run-uat
```

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

The kind is `observation`, `http_exchange`, `screenshot`, or `trace`. Without `:kind`, the extension sets it: `.png`, `.jpg`, `.jpeg`, and `.webp` are `screenshot`, `.zip` and `.trace` are `trace`, and other files are `observation`. A `.json` file is an `observation`. Add `:http_exchange` for an HTTP exchange.

The extension sets the media type:

| Extension               | Media type                 |
| ----------------------- | -------------------------- |
| `.png`                  | `image/png`                |
| `.jpg`, `.jpeg`         | `image/jpeg`               |
| `.webp`                 | `image/webp`               |
| `.gif`                  | `image/gif`                |
| `.json`                 | `application/json`         |
| `.xml`                  | `application/xml`          |
| `.csv`                  | `text/csv`                 |
| `.txt`, `.log`          | `text/plain`               |
| `.md`                   | `text/markdown`            |
| `.html`                 | `text/html`                |
| `.zip`                  | `application/zip`          |
| Another or no extension | `application/octet-stream` |

A command can take one text and one or more files together.

### Read evidence back

`checkmate evidence get <evidenceId> --out <file>` writes the stored bytes to a new file. The run page of the review UI shows images inline, and shows plain text, JSON, Markdown, XML, and CSV up to 64 KiB as text. A direct evidence link opens only images and plain text in the browser. It sends other types as a download.

## Findings

- `defect`: a product defect. It names one or more failed assertions, and only failed assertions.
- `potential_issue`: a suspicion. It can name any assertion of a selected test.
- Each failed assertion needs a defect. `run finish` refuses the run without it.
- The requirements of a finding belong to the named tests.
- The evidence of a finding belongs to the named assertions, or to their tests.

A tool or access failure is an `error` outcome, not a defect. New ambiguity is a gap: record it with `run gap`. The payloads are in [Payloads](payloads.md#finding).

### Open defects

A defect stays open until one of these occurs:

1. A later finished run of the same plan selects each test of the defect, and each of these tests passes.
2. A later finished run in the retest chain of the defect's run fails a test of the defect and records its own defect for it. The new defect replaces the old defect. The retest chain is the runs that name the run with `--retest-of`, directly or through other retests.
3. The oracle rejects the result of the defect's run. A rejected result means that the record is wrong. Its tests need a retest.

"Later" means that the run began after the defect's run. The order in which the runs finished does not matter. A later run counts only when it is on the same instance, on a different build, or in the retest chain of the defect's run. On the same build, a pass on one instance does not close a defect that a run on another instance found. A refreshed sandbox is a new instance, and its retest is in the retest chain.

A started run closes no defect. A rejected run closes no defect and replaces no defect. A run outside the retest chain that finds the same failure does not replace the defect, so both defects stay open. The cross-plan dependency rule is different: it accepts a pass on any instance of the build.

`checkmate finding list --open` lists each open defect. `checkmate status` uses only the open defects of tests that are `ready` in the latest revision. It ignores a defect when each of its tests is deferred or removed. A test whose local prerequisite is deferred also counts as deferred. The defect is still real, so `finding list --open` still lists it.

### Retest verdicts

A retest records the open defects of the earlier run when it begins. When the earlier run is itself a retest, the open defects of its chain stay in the list, so a retest of an interrupted retest keeps them. `run show` and `status` print one verdict for each of them:

```text
run-1/F1	retest	fixed	T2	Discount applies twice
run-1/F2	retest	not_fixed	T4	Total ignores the fee
run-1/F3	retest	not_retested	T6	Badge count is stale
```

| Verdict        | When                                                   |
| -------------- | ------------------------------------------------------ |
| `fixed`        | Each test of the defect passed in the retest.          |
| `not_fixed`    | A test of the defect failed in the retest.             |
| `not_retested` | Any other case, for example a test is open or blocked. |

`status` prints the verdicts of the latest retest in begin order, but only while one of its defects is open or while it is the latest finished run. Its lines also name the retest: `run-1/F1 retest run-2 fixed <title>`.

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
- in a retest, no `not_run` outcome for a selected test of an open defect of the earlier runs. An `inconclusive` test, or a `blocked` test whose prerequisite failed, gives the verdict `not_retested`,
- a defect for each failed assertion.

`run finish --completion interrupted` needs `--cause` and `--reason`. The cause is one of:

| Cause              | When                                                     |
| ------------------ | -------------------------------------------------------- |
| `deadline`         | 90% or more of the [deadline](#deadline) is used.        |
| `host_stopped`     | The host, the factory, or the oracle stopped the run.    |
| `tool_unavailable` | A tool that every remaining test needs is not available. |

The result records them as `completionCause` and `completionReason`. `run show` prints `cause=` on line 1, and the exports show both. `--cause` applies only to `interrupted`. `operational_error` can have a `--reason`.

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
checkmate export run run-1 --format junit --out reports/run-1.xml
```

- `--format` is `md`, `html`, or `json`. `export run` also takes `junit`. Without `--out`, the report goes to standard output. `--out` refuses an existing file.
- `export run` needs a finished run. `export plan` takes a revision reference, or a plan ID for the latest revision.
- A run report shows the summary with the instance, the acceptance, the plan approval, each outcome, each assertion with its check, observation, and evidence, the findings, the new gaps, coverage, and cleanup. The full JSON record follows in a folded section.
- The Markdown and HTML exports show the [metadata](payloads.md#metadata) of the requirements, the tests, and the findings as `key=value` lists.
- The Markdown and HTML exports replace control characters with U+FFFD, as the JUnit export does.
- The HTML report is one self-contained file. It shows small images and text evidence inline. It has a print stylesheet, so a browser can save it as a PDF.
- The JSON run report is `{ "result", "sha256", "acceptance", "planApproval", "plan" }`. `acceptance` and `planApproval` each have `state` and `latest`. `latest` is the latest verdict with its `verdict`, `actor`, `at`, `rationale`, and `sha256`, or `null`. `plan` has the requirements and the tests of the plan revision, with their metadata. A JSON plan export is the stored plan revision.

### JUnit XML

`export run <runId> --format junit` writes JUnit XML for a CI system or a test management tool.

- The root `<testsuites>` has one `<testsuite>`. Its name is `<planId>@<revision>`. Its properties are `runId`, `build`, `instance`, `target`, `completion`, and `coverage`.
- Each selected test is one `<testcase>`. `classname` is the plan ID. `name` is the test ID, for example `T1`. `time` is the seconds from the first assertion result of the test to its close. A test without an assertion result has `time="0"`.
- `<testsuites>` and `<testsuite>` have `time`: the seconds from the run start to the run finish.
- Each test case has properties. `title` is the test title. `requirements` is the list of requirement IDs, separated by commas. Each metadata key gives one more property. Its name is `metadata.<key>`, for example `metadata.xrayKey`. Thus a metadata key cannot replace a built-in property.
- The JUnit format does not define properties in a test case. Jenkins, GitLab, and Xray read them.
- `timestamp` is the start time in UTC, to the second, without a time zone, for example `2026-11-14T18:53:46`.
- `failed` gives `<failure>`. Its `type` is `defect`. Its `message` is the title of the first defect of the test in finding ID order, so `F2` comes before `F10`. Its text has the expected value, the observed value, and the reproduction steps of each finding of the test, in the same order.
- `blocked` and `not_run` give `<skipped>`. `error` and `inconclusive` give `<error>` with the outcome as `type`. `passed` gives no element.
- Checkmate escapes the text and replaces characters that XML does not permit with U+FFFD.
- The renderer escapes untrusted text. The HTML has a Content Security Policy that blocks scripts and remote resources.
- An export is a view. The database is the authority. Do not edit an export to change a verdict.

The review UI offers the same exports. The run page also offers JUnit XML. [Examples](../examples/README.md) has exports from a live run.

## Retention

- Checkmate does not sanitize evidence. It stores what QA sent.
- Do not capture credentials, cookies, authorization headers, or full raw transcripts.
- The workspace owner owns access to the database and how long it keeps evidence. Checkmate cannot delete rows. To remove evidence, delete the database file, or start a new one for each retention period.
- A digest shows that the bytes did not change after the write. [Limits](record.md#limits) lists what the checks do not show.

## Next

- [The record](record.md): how the database stores runs and evidence.
- [Decide as the oracle](../guides/oracle.md#accept-a-result): accept or reject a result.
