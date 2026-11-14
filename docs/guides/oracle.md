# Decide as the oracle

> **Guide** · For the oracle: the agent or person who answers gaps, changes plans, approves revisions, and accepts results.

The oracle has the authority, and the agents do the work. Each decision is a record with an actor, a rationale, and the digest of what the oracle saw.

## Find what waits for you

```sh
checkmate inbox
```

```text
completed inbox gaps=2 plans=0 results=1 requests=0
checkout@1/G1	gap	blocking	Does the promotion stack?
checkout@1/G4	run_gap	non_blocking	run-1	Must the banner wrap?
run-1	result	checkout@1	b1	partial	passed=1
```

The inbox lists the gaps to answer, the gaps of runs that the plan does not have yet (`run_gap`), the plans to approve, the results to accept, and the plan requests without a revision (`requested`). The plan requests wait for the planner, not for you.

To see one ticket, run `checkmate status <planId>`. It names the loop state and who acts next. In the review UI, the inbox is the start page.

## The decisions

| Decision          | Command                                                            | In the UI                         |
| ----------------- | ------------------------------------------------------------------ | --------------------------------- |
| Answer a gap      | `checkmate gap answer <planId> <gapId> --kind ...`                 | Inbox or plan page                |
| Change a plan     | `checkmate plan edit <planId@rev>`, or with `--patch`              | `Edit plan`                       |
| Adopt run gaps    | `checkmate plan adopt-gaps <planId@rev> --run <runId> [--gaps G4]` | `Bring into plan` on the run page |
| Approve or reject | `checkmate plan approve\|reject <planId@rev> --rationale ...`      | Plan page                         |
| Accept or reject  | `checkmate result accept\|reject <runId> --rationale ...`          | Run page                          |

Each answer, approval, and result decision needs `--rationale`. Add `--expect-sha <digest>` to stop the decision when the snapshot changed after you read it.

## Answer a gap

```sh
checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
  --value "The promotion replaces the loyalty discount. The total is 240 PLN." \
  --rationale "Product owner decision."
```

Choose one kind:

| Kind                | Use it when                         | Effect in the next revision                                                                                            | Needs                                |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `clarify`           | You know the answer.                | The gap is `resolved`. The planner writes the assertions that the answer makes known.                                  | `--value`, `--rationale`, `--source` |
| `accept_assumption` | You accept a reasonable assumption. | The gap is `resolved`. The value stays visible in `assumptions`.                                                       | `--value`, `--rationale`             |
| `defer`             | The question is out of scope now.   | The gap is `deferred`. A blocking gap defers its tests, and coverage stays incomplete. A non-blocking gap only closes. | `--value`, `--rationale`             |

An answer is a pending decision. It does not change the plan. The revise stage applies the answers and writes the next revision: `checkmate delegate revise <planId>`, or `/checkmate:revise <planId>` in Claude Code. Then approve that revision.

A gap can have one pending decision. The gap must be open in the latest revision, or be a gap of a run of the plan.

## Answer a gap from a run

QA can find a new gap during a run. It does not change the plan by itself. You have two choices:

- **Answer it.** `checkmate gap answer <planId> <gapId>` adds the gap to the plan, then records the answer. The reply prints `from=<runId>`, `revision=`, and `edit=`. To drop a run gap, answer it with `--kind defer`.
- **Adopt it without an answer.** `checkmate plan adopt-gaps <planId@rev> --run <runId>` adds the open gaps of the run. `--gaps G4,G5` selects gaps. Do this to block the affected tests now.

The inbox lists a run gap until a later revision of the plan has a gap with the same ID. When two runs have a gap with the same ID, bring one in with `--gaps` first.

## Change a plan

`plan edit` changes the latest revision directly. Send a full candidate, or only the changes with `--patch`.

```sh
checkmate plan edit checkout@2 --patch <<'EOF'
{ "tests": { "T2": { "assertions": { "A3": { "check": "totalPLN equals 240.", "checkKind": "deterministic" } } } } }
EOF
```

| Revision state             | Effect                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ |
| No approval and no run     | The revision changes in place. It gets a new digest. The log records the edit. |
| Approved, or used by a run | Checkmate saves the next revision. The earlier revision does not change.       |

The reply prints `edit=in_place` or `edit=new_revision`. [Payloads](../reference/payloads.md#plan-edit) has the full rules.

## Approve a plan

```sh
checkmate plan show checkout@2
checkmate plan approve checkout@2 --rationale "Tests and assertions match the brief."
```

When the target requires plan approval, a run needs an approval of the exact revision. A new revision needs a new approval. The target profile sets the policy. Read [Approvals policy](../reference/payloads.md#approvals-policy).

You can approve a revision that still has open gaps. Then QA can run the ready tests early with `--partial ready_only`.

## Accept a result

```sh
checkmate run show run-1
checkmate result accept run-1 --rationale "The defect in T3 is real. Fix before release."
```

- A run with failed tests can be a correct result. Accept it when the record is true. Acceptance is an oracle record. It is not a release decision by Checkmate.
- An `inconclusive` test is not a defect. The evidence was not sufficient. Give a more exact answer, change the assertion, or ask for a retest with better evidence.
- Of a retest chain, only the latest run waits for acceptance.
- When result acceptance is required, a cross-plan dependency needs an accepted result.

## Example

A full decision round after a plan with one gap:

```sh
checkmate inbox
checkmate gap answer checkout G1 --kind clarify --source docs/promo.md \
  --value "The promotion replaces the loyalty discount. The total is 240 PLN." --rationale "Product decision."
checkmate delegate revise checkout --allow Read --allow Bash
checkmate status checkout
checkmate plan approve checkout@2 --rationale "Matches the answer."
```

`status` prints `state=needs_approval waitsOn=oracle` and the next command before the approval.

## Next

- [Review in the browser](review-ui.md): make the same decisions in the UI.
- [Runs and evidence](../reference/runs.md): what outcomes and coverage mean before you accept.
- [Payloads](../reference/payloads.md): candidates, deltas, and patches.
