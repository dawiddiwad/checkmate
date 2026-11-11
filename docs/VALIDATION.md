# Validation

This page says what Checkmate validates, how the tests are organized, and what a live run showed. Contract version: `toolkit-2`.

## What the code checks

Checkmate validates structure and relationships. It cannot prove that an observation is true.

### Payload shape

`plugin/src/contracts.ts` validates each payload against its JSON Schema before any rule check. The validators in `plugin/src/validators.js` are generated from `plugin/contracts/`. A payload with an unknown field, a missing field, or a wrong type is refused.

| Schema                       | Checked by                        |
| ---------------------------- | --------------------------------- |
| `profile.schema.json`        | `target save`                     |
| `plan-request.schema.json`   | `plan open`                       |
| `plan-candidate.schema.json` | `plan save`                       |
| `plan-delta.schema.json`     | `plan revise`                     |
| `plan.schema.json`           | each stored plan revision         |
| `finding.schema.json`        | `run finding`                     |
| `gap.schema.json`            | `run gap`, and each gap in a plan |
| `result.schema.json`         | each stored result                |
| `response.schema.json`       | the output of a delegated worker  |

### Targets (`plugin/src/targets.ts`)

- The setup request has an HTTP or HTTPS URL and non-empty, unique capabilities and operations. A second `target open` with other values is refused.
- A profile has the same target ID, URL, capabilities, and operations as the request.
- A profile has one host tool for each capability and no credentials in the URL. Setup records an actual version, or `host-managed` when a connector exposes none.
- Optional setup and plan instructions guide context gathering and tool use. Native permissions remain with the host.
- A profile revision is the latest revision plus 1. An identical save changes nothing.

### Plans (`plugin/src/contracts.ts`, `plugin/src/plans.ts`)

- IDs are unique: requirements, tests, gaps, decisions, assertions in a test, and coverage rows.
- Each reference names a known requirement, test, or gap.
- Each requirement has one or more tests or gaps.
- `gapIds`, readiness, and coverage are equal to the values that Checkmate calculates from the gaps.
- A ready test has one or more assertions, a capability of the target, and allowed operations only.
- An open gap has no decision. A resolved or deferred gap has a matching decision. A `clarify` decision has a source. An accepted assumption stays visible.
- Cross-plan references name a plan and a test in the latest revision of that plan. A dependency cycle across all plans is refused.
- `gap answer` needs an open gap in the latest revision, a known kind, a value, and a rationale. A gap has one pending decision.
- `plan revise` needs one or more pending decisions. A delta changes only `action`, `preconditions`, and `assertions` of affected tests. A removed assertion ID cannot come back. A new assertion has a check and an oracle kind.
- A concurrent revise of the same plan fails on the primary key.
- UI edits create a new revision, preserve existing run snapshots, and derive readiness and coverage again. Pending decisions must be applied first. A stale digest refuses the edit.
- `plan approve` and `plan reject` need a revision reference and a rationale. `--expect-sha` stops a decision on a changed snapshot.

### Gate (`plugin/src/plans.ts`)

`run gate` and `run begin` collect every reason. They do not stop at the first one:

1. The target profile is ready for live execution.
2. When plan approval is required, the latest approval of the exact revision digest is `approved`.
3. With `wait_for_resolution`, no blocking gap is open.
4. Each selected test exists, is ready, uses a capability and allowed operations of the target, has one or more assertions, and has its local prerequisites in the selection.
5. Each cross-plan dependency has a finalized `passed` result for the same build, accepted when required, and no open blocking gap applies to it.
6. A retest names a finished run of the same plan and target, with a different build.

### Runs (`plugin/src/runs.ts`)

- `run begin` refuses a run ID that exists.
- `run check` needs a started run, a selected and open test, a known assertion without a result, and passed local prerequisites. A result needs the fields in [Evidence](EVIDENCE.md#assertion-results).
- Evidence captures are regular files inside the run's temporary directory, at most 32 MiB each, and listed once. Durable evidence is stored as database BLOBs.
- `run close` derives the outcome from the assertion results, or records `blocked`, `not_run`, or `error` with a reason. A test with assertion results can only be closed as `error` by hand.
- `run finding` checks that a defect names only failed assertions, that the requirements belong to the named tests, and that the evidence belongs to the named assertions or their tests.
- `run gap` checks that a runtime gap is open, has a new ID, and names known requirements and tests.
- `run finish` checks the rules for `completed` in [Evidence](EVIDENCE.md#completion-outcomes-and-coverage), records unselected tests as `not_run`, calculates coverage, and validates the result snapshot.
- A finished run does not change. `result accept` and `result reject` need a finished run and a rationale.

### Store (`plugin/src/store.ts`)

- Every write runs in one `BEGIN IMMEDIATE` transaction with its operation row. A refused write rolls back and records a `rejected` operation row.
- Triggers refuse `UPDATE` and `DELETE` on every table. A decision can set `applied_revision` once.
- Foreign keys are on. WAL mode lets a reader see committed writes while a writer holds the lock.
- Each snapshot body is canonical JSON. Its digest is the SHA-256 of that text.
- Writes record an explicit actor or the workspace Git/operating-system user.

### Delegation (`cli/src/launcher.ts`)

- `delegate` refuses an empty `--allow` list and an unknown subject before it starts Claude Code.
- The parent requires a structured worker response for the same subject. Then it reads the database for the recorded change. A worker claim without the change is `operational_error`.
- At the deadline or a signal, the launcher stops the worker's process group. An execute run stays `started`.

## Tests

Run the fast suite with `npm test` (`node --test test/*.test.ts`). It uses temporary workspaces. It needs no network and no Claude credential.

| File                      | Covers                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `test/store.test.ts`      | Schema creation, version check, immutability triggers, foreign keys, WAL readers, canonical JSON, ULIDs.                           |
| `test/targets.test.ts`    | Setup requests, profile checks, revision order, default approval policy.                                                           |
| `test/plans.test.ts`      | Plan save, plan rules, decisions, delta revise, refused deltas, concurrent revise, approval, gate reasons.                         |
| `test/cross-plan.test.ts` | Missing plans and tests, cycles, blocks by result, acceptance, and open gaps in other plans.                                       |
| `test/runs.test.ts`       | Outcome derivation, checks, closes, findings, runtime gaps, finish rules, inconclusive coverage, resume, retest, result decisions. |
| `test/evidence.test.ts`   | Blob deduplication, file deletion, equal bytes on read, path containment, the 32 MiB limit.                                        |
| `test/views.test.ts`      | The inbox and the approval policy.                                                                                                 |
| `test/cli.test.ts`        | Compact and JSON output, `--tests`, `--fields`, `--expect-sha`, read-only `query`, actor, operation log, export.                   |
| `test/launcher.test.ts`   | Worker output checks, database checks after a worker, deadlines, browser cleanup. It uses a fake Claude CLI.                       |
| `test/tools.test.ts`      | A real browser and HTTP API against the checkout fixture. It needs Chromium.                                                       |
| `test/package.test.ts`    | `npm pack` and install of `@xoxoai/checkmate`, run from `node_modules`, `delegate` loads the bundled plugin.                       |
| `test/release.test.ts`    | Version rules and the version files of the plugin, marketplace, root package, and CLI package.                                     |
| `test/ui.test.ts`         | UI pages, escaping, rationale and confirm steps, stale digests, Host and Origin checks, evidence types, live events.               |
| `test/ui.browser.test.ts` | The UI in a real browser: keyboard, forms, confirm in place, live updates, dark mode, no JavaScript.                               |

Other checks:

- `node test/plugin.ts` copies `plugin/` outside the repository and runs the bundled CLI without npm install.
- `npm run phase:verify` runs type generation checks, the bundle check, TypeScript, lint, formatting, `npm test`, and the plugin check.
- `npm run test:live` runs `test/live.ts` and `test/live-session.ts` with an authenticated Claude Code CLI. Read [Development](DEVELOPMENT.md) for the setup.

## Live run

Date: 11 November 2026. `test/live.ts` passed on Linux with Node.js `v24.22.2`, Claude Code `2.1.319`, Playwright CLI `0.1.23`, and `ANTHROPIC_MODEL=claude-haiku-5-5`. The worker permissions were `Read`, `Write`, `Edit`, and `Bash` in a temporary workspace.

| Stage             | Seconds | Status           |
| ----------------- | ------: | ---------------- |
| Setup             |    16.3 | `completed`      |
| Plan              |    23.3 | `needs_decision` |
| Revise            |    17.6 | `completed`      |
| Execute           |    48.5 | `completed`      |
| Retest            |    48.7 | `completed`      |
| Same-session plan |    35.5 | `needs_decision` |

What the run showed:

- Setup saved profile `checkout-local@1` with the actual tool versions.
- The plan had two blocking gaps: promotion stacking and refund eligibility. The first `plan save` was refused, and the worker corrected the candidate. Planning did not run a fixture action.
- The caller clarified the promotion rule and deferred refunds. Revise added the assertion to T3. The caller approved `checkout@2`.
- Execute found the seeded defect: the quote returned 220 PLN instead of 240 PLN. T3 failed with a defect finding. Refund coverage stayed uncovered. The caller accepted the result.
- After the fixture changed, a retest on a new build passed T2 and T3. The first run did not change.

The exported plans and runs are in [docs/examples](examples/README.md). These values describe one run. They are not performance targets. Model behavior, load, and tool latency can change them. A passed live run does not prove that a worker always follows the skills. The commands refuse a payload that does not satisfy the contracts.

## Support limits

Linux is the measured platform. macOS was not tested. The launcher rejects Windows.

Local checks do not show that hosted CI passed. The PR check reports that result separately. Live CI needs a repository secret and a manual workflow dispatch.
