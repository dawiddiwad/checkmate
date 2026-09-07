# CLI Reference

The Checkmate CLI is non-interactive. Machine-readable commands write exactly one complete JSON document to stdout. Diagnostics and discarded-worker-stream notices use stderr.

## Commands

```text
checkmate run <request.json|-> [--config <path>]
checkmate validate <request.json|-> [--config <path>]
checkmate describe [--config <path>]
checkmate --help
checkmate --version
```

`-` reads the request from stdin. Request file paths and explicit config paths are resolved from the current working directory. Without `--config`, Checkmate reads exactly `$PWD/checkmate.config.json`; it does not walk parent directories.

## Run

`run` performs bounded preparation in the CLI parent. Invalid input returns an `InvalidInvocationResultV1`. An operational preparation failure or identity-allocation failure returns a parent-authored `PreExecutionOperationalResultV1` with `infra / pre-execution-error`, exit `3`, `targetMutation: "not-attempted"`, and no scenario, step, usage, or evidence claims. A valid request reserves one run directory and starts a child worker. The worker executes only the prepared plan; it does not reread configuration, reprobe preflight secrets, or allocate another identity.

The parent is the sole stdout writer. It accepts worker output only after validating the complete IPC frame, digest, deterministic bytes, `RunResultV1` schema, immutable prepared identity, policy, limits, step grammar, usage, and committed evidence references. Successful committed output is byte-identical to the run's `result.json`.

If no authoritative worker result is accepted before the applicable cutoff, the parent emits `ContainmentResultV1`. Containment has no semantic `steps`, usage, evidence-completeness claim, or committed result reference.

## Validate

`validate` performs the same static preparation as `run`, including secret availability, but stops before identity allocation, executable import, driver startup, target mutation, or output creation.

## Describe

`describe` returns schema references, policy metadata, registered static driver descriptors, logical secret requirements, and reason-specific routing guidance. It neither imports drivers nor probes secret values.

## Exit Codes

| Code | Route                                                                                 |
| ---: | ------------------------------------------------------------------------------------- |
|  `0` | Passed run, valid request, or available description                                   |
|  `1` | Application expectation failure                                                       |
|  `2` | Model failure                                                                         |
|  `3` | Infrastructure failure, interruption, containment, or unexpected static-command error |
|  `4` | Invalid invocation or unavailable requested configuration                             |

Exit codes provide coarse shell routing. The stdout document remains the detailed contract.

## Signals And Cutoffs

Scenario timing starts when the parent forks the worker, so driver import and startup consume the scenario limit. Normal `cleanup-started` disarms the scenario timer and starts one fresh cleanup cutoff. A scenario timeout or first `SIGINT`/`SIGTERM` sends one cooperative abort and immediately starts one cleanup/termination bound; a later cleanup notification cannot extend it.

The parent compares its monotonic clock with the absolute active deadline before every state transition and after asynchronous terminal reconciliation. After an external signal it accepts only `interrupted`, `driver-teardown-failed`, or `result-write-failed`. After a run deadline it accepts only `scenario-timeout`, `driver-teardown-failed`, or `result-write-failed`. Unrelated pass, application, and model results cannot override a latched stop cause.

A worker-finalized interrupted result accepted in time exits `3`. A second signal after an external stop forces the first signal's native route: `130` for `SIGINT` or `143` for `SIGTERM`, with no fabricated stdout envelope.

## Output Discipline

- Worker stdout and stderr bytes are counted, drained, and discarded.
- Worker logger diagnostics are exact-secret and pattern sanitized before IPC.
- The parent pattern-sanitizes diagnostic messages again before stderr.
- Diagnostic `code` and RFC 6901 `path` fields remain structural and are not rewritten.
- Terminal result bytes are never reserialized or modified by the parent.
