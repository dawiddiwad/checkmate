# Evidence and reports

Save evidence under the run's `evidence/` directory. Each entry has an ID, kind, relative path, and SHA-256 digest.

The finalizer checks file existence, path containment, symlink resolution, and the digest. A passed or failed assertion needs an observation and evidence. The expected result and assertion kind must match the plan.

A failed assertion needs a defect finding. A defect identifies the tests, requirements, expected behavior, observed behavior, reproduction steps, and evidence. Use `potential_issue` for an inference. Keep requirement gaps separate.

Completion describes the operation: `completed`, `interrupted`, or `operational_error`. Test outcomes are `passed`, `failed`, `blocked`, `not_run`, or `error`. Coverage is `complete`, `partial`, or `not_executed`.

A tool or access failure is an error. It is not a product defect. A cleanup failure prevents `completion: completed`.

JSON is authoritative. The renderer creates Markdown and HTML from the same record. It escapes HTML and uses a safe Markdown code fence. HTML uses no scripts or remote resources. Do not edit a generated view to change a verdict.

Publication uses an exclusive temporary file, file sync, and a hard link that refuses overwrite. A completed result cannot replace an existing result. Generated views can be recovered with `report` after a rendering failure.

Use a trusted local workspace. Path checks are not a filesystem sandbox and do not protect against an actor who can replace files concurrently. The scripts cannot prove that an agent's interpretation is true.

Select evidence fields before retention. Do not save credentials, cookies, authorization headers, or full raw transcripts. Screenshots and arbitrary text are not sanitized automatically. The caller owns evidence access and retention.
