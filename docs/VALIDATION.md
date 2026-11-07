# Validation record

Date: 7 November 2026. Repository and plugin version: `0.7.0`.

The checks ran on Debian Linux with Node.js `24.22.1`, Claude Code `2.1.319`, Playwright CLI `0.1.23`, and Chromium `156.0.8078.79`.

After this record, the plugin moved to `plugin/` and the runtime npm dependencies were removed. The commands now calculate plan coverage and evidence digests. `finalize` records an omitted unselected test as `not_run`. The live tests use Sonnet by default. The next section records the checks after these changes. The later sections record the earlier run.

## Checks after the plugin layout change

Date: 7 November 2026. The checks ran in a Linux cloud container with Node.js `24.22.1`, Claude Code `2.1.319`, Playwright CLI `0.1.23`, and Chrome for Testing `153.0.8010.12`. The live tests used `ANTHROPIC_MODEL=sonnet`, which selected `claude-sonnet-5-5`. Hosted CI did not run these checks.

- Type generation, validator generation, strict TypeScript checks, lint, and formatting: passed.
- `npm test`: 24 of 25 tests passed. The missing-authentication test failed because the container had a Claude login. This test checks the host configuration, not Checkmate.
- `node test/plugin.js`: passed. The copied `plugin/` directory ran outside the repository without npm install.
- Claude plugin and marketplace validation: passed. The validator reported a missing marketplace description.
- `npm run test:live`: passed with an existing host login (`CHECKMATE_USE_HOST_LOGIN=1`). The delegated stages, the defect, the retest, same-session execution, and the permission denial gave the expected results.

| Stage                | Seconds | Status           |
| -------------------- | ------: | ---------------- |
| Setup                |    19.3 | `completed`      |
| Plan                 |    24.4 | `needs_decision` |
| Ready-only execution |    29.0 | `completed`      |
| Revise               |    13.4 | `completed`      |
| Execute              |    29.0 | `completed`      |
| Retest               |    17.7 | `completed`      |

These values describe one run. They are not performance targets.

Earlier live runs during these changes failed. Each failure came from a worker document that did not follow a skill:

- A worker omitted an unselected test. `finalize` now records an omitted unselected test as `not_run`.
- A worker recorded an evidence path relative to the workspace. The execute skill now gives the path format and an example.
- On Node.js `22.23.4`, Sonnet correctly marked the target as not ready, because Checkmate requires Node.js 24.12.0 or later.

The passing run does not prove that a worker always follows the skills. The finalizer rejects a document that does not satisfy the contracts.

## Automated checks

- `npm run phase:verify`: passed. All 21 tests passed. No test was skipped.
- Type generation, strict TypeScript checks, lint, and formatting: passed.
- Clean plugin install with production dependencies: passed. Node ran the TypeScript CLI and API without a build.
- Claude plugin and marketplace validation: passed. The validator reported optional listing metadata warnings.
- Documentation contracts, file digests, local links, and agent Markdown formatting: passed.
- All eight animation scenes fit the viewport. The GIF and static infographic were inspected.

The tests cover stale inputs, conflicting writes, blocked prerequisites, missing evidence, path escape, report escaping, duplicate run IDs, worker output errors, missing authentication, and worker interruption.

## Release checks

Version tests passed for the first `0.7.0` release, patch increases, repeated preparation, and rejection of stale versions. All version files stayed in sync. The package remained private.

Local simulations passed for Dependabot merge detection, direct pushes, manual releases, PR resume, invalid input, repeated release creation, and tag mismatch rejection. These simulations used a mock GitHub API. They did not create a release.

Actionlint `1.7.12` passed after excluding its unsupported `queue` field check. GitHub documents [`queue: max`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency) as a supported setting. The workflow preserves that setting from the prior release job.

## Live Claude checks

`npm run test:live` passed with subscription authentication.

Claude completed setup in a workspace without application source. It recorded three blocking questions: discount stacking, refund eligibility, and refund permission. The caller clarified the discount rule and deferred both refund gaps. No interactive response was needed.

The default gate blocked execution. Explicit ready-only execution ran the standard checkout test. A fresh session applied the decisions and published a new plan revision.

The execution found the seeded defect: the quote returned 85 PLN instead of 90 PLN. After the caller changed the fixture behavior, a new retest observed 90 PLN and passed. The first failure remained available. Refunds and omitted checks remained uncovered.

A separate Claude session invoked the plan skill directly. Another session executed a saved plan and published its result through the CLI. A live permission-denial check returned `needs_decision` without a test action.

## Measured stage durations

| Stage                | Seconds |
| -------------------- | ------: |
| Setup                |    36.7 |
| Plan                 |    27.0 |
| Ready-only execution |    71.3 |
| Revise               |    34.3 |
| Execute              |    50.1 |
| Retest               |    31.5 |

These values describe one local run. They are not performance targets. Model behavior, load, and tool latency can change them.

The live test retains its requests, plans, evidence, reports, and timing record in the temporary path printed by the runner. This record contains no credentials or raw model transcript.

## Support limits

Linux is the measured platform. macOS and Windows were not tested. The launcher rejects Windows.

Local checks do not establish that hosted CI passed. The PR check reports that result separately. Live CI requires a repository secret and a manual workflow dispatch.
