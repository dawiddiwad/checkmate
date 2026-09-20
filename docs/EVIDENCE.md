# Evidence And Durability

Every valid run owns one invocation directory beneath the manifest's `outputDirectory`.

```text
.checkmate/runs/<utc>-<scenario-slug>-<run-id>/
|-- invocation.json
|-- checkpoint.json
|-- evidence/
|   |-- harness/steps/001-<step-slug>/transcript.md
|   `-- driver/<driver-id>/...
`-- result.json
```

The 16-character lowercase hexadecimal `runId` is generated from eight random bytes. It identifies one attempt and is not a request hash. Concurrent runs, including runs with the same scenario ID, receive separate directories and mutable state.

## Compact Result

The final envelope always carries compact routing and diagnosis data: top-level status/category/reason, target mutation state, timing, driver and policy identity, effective limits, aggregate tokens, every step state, compact tool-call summaries, evidence completeness, references, and diagnostics.

Transcripts, snapshots, screenshots, logs, and driver-specific artifacts remain outside the envelope. Follow only `evidence.references`; never infer filenames or promote `checkpoint.json` to a result.

The built-in web driver's `logsAsEvidence: true` setting collects messages selected by its `logLevel` into one scenario-level `web-driver-log` artifact with media type `text/plain`. The transcript is capped at 1 MiB and ends with `[log truncated]` when the cap is reached. It is omitted when logging is off or no messages are emitted. A contained or forcibly terminated worker may be unable to flush it.

## Retention

| Policy              | Passed step                    | Failed step                    |
| ------------------- | ------------------------------ | ------------------------------ |
| `on`                | Retain selected heavy evidence | Retain selected heavy evidence |
| `retain-on-failure` | Discard heavy evidence         | Retain selected heavy evidence |
| `off`               | Discard heavy evidence         | Discard heavy evidence         |

Compact result data is retained independently of this table. Opaque evidence is discarded unless the operator also sets `allowOpaque: true`.

`evidence.state: "complete"` means the selected policy was fulfilled, including when it required no heavy artifacts. `partial` means an optional capture or persistence operation failed. A driver is not required to produce every declared evidence kind on every run.

## Redaction

With `redaction: "on"`, Checkmate applies exact resolved-secret replacement, credential-pattern recognition, and field-aware content redaction before data becomes durable or enters terminal IPC. JSON and YAML evidence is parsed, redacted structurally, and deterministically reserialized. Malformed structured evidence is rejected.

Structural metadata is copied exactly and must not contain confidential values: IDs, status/category/reason values, diagnostic codes and paths, timestamps, effective limits, usage, evidence kinds/media types/producers/paths, and driver/tool identities.

With `redaction: "off"`, raw harness-owned content and accepted evidence bytes are preserved by explicit operator choice. The API result, `result.json`, terminal IPC, and CLI stdout may therefore contain raw values. Out-of-band diagnostics remain sanitized and raw worker streams remain discarded under both settings. `web-driver-log` evidence is collected after mandatory diagnostic sanitization even when evidence redaction is off.

## Capture Limits

- One candidate: at most 10 MiB before and after transformation
- Accepted pending buffers: at most 64 MiB per invocation
- Counters are released when candidates are committed or discarded
- Concurrent in-process invocations do not share a global allowance

An embedding host running `N` concurrent calls may retain approximately `N * 64 MiB` plus driver and model overhead. The caller owns admission control.

## Atomic Commitment

Files are written to a restrictive same-directory temporary file, flushed, renamed, and followed by directory synchronization where supported. Evidence references become visible only after this sequence succeeds. A post-rename synchronization failure is durability-uncertain and publishes no reference even if the destination is observable.

`invocation.json` is mandatory before executable driver startup. `checkpoint.json` is an atomically replaced partial diagnostic snapshot, not proof of process liveness, a resume point, or a terminal result. `result.json` is the only durable terminal marker. Parent pre-execution operational errors and containment results do not claim a durable terminal file.

Optional evidence failure preserves the established verdict, marks evidence partial, and appends a diagnostic. Checkpoint failure appends a diagnostic without changing verdict or evidence completeness. Failure to commit final `result.json` changes the top-level route to `infra / result-write-failed`, preserves completed semantic state, and returns an explicitly uncommitted envelope through the API or CLI when it fits the IPC bound.

## Byte Identity

Committed `result.json` uses deterministic two-space JSON with recursively sorted object keys, preserved array order, UTF-8 without a BOM, and one trailing line feed. The in-process finalized object is parsed from those bytes. The CLI verifies and writes the same bytes unchanged. Parent-authored containment has stdout bytes only and claims no durable result.
