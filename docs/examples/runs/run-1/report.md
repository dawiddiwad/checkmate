# Test result: run-1

Generated from result.json. Completion, test outcomes, and coverage are separate. Edit the JSON record, not this view.

| Field | Value |
| --- | --- |
| Completion | completed |
| Coverage | partial |
| Run | run-1 |
| Application build | fixture-build-1 |
| Host | example-host 1.0.0 |
| Model | example-model |
| Host record | declared, permissions: session |
| Plan | plans/checkout/v2.json |
| Target profile | profile.json |
| Started | 2026-11-07T14:24:25.788Z |
| Finished | 2026-11-07T14:24:25.850Z |

## Tests

| Test | Outcome | Expected | Observed | Reason | Evidence |
| --- | --- | --- | --- | --- | --- |
| T1 | passed | The order total is 400 PLN. | Order confirmed: 400 PLN | — | [evidence/T1.txt](evidence/T1.txt) |
| T2 | failed | HTTP 200 and totalPLN equals 240, with the loyalty discount replaced. | HTTP 200; totalPLN = 220 | Observed total differs from expected total. | [evidence/T2.txt](evidence/T2.txt) |
| T3 | not\_run | — | — | Test was not selected or was deferred. | — |

## Findings

### F1 · defect · medium: Promotion stacks with loyalty

| Field | Value |
| --- | --- |
| Tests | T2 |
| Requirements | R2 |
| Expected | 240 PLN |
| Observed | 220 PLN |
| Evidence | [evidence/T2.txt](evidence/T2.txt) |

1. Create a 400 PLN cart with 20 PLN loyalty.
2. Apply a 40 percent promotion.
3. Read the quote total.

## New gaps

No new gaps.

## Coverage

| Requirement | Status | Tests | Reason |
| --- | --- | --- | --- |
| R1 | tested | T1 | — |
| R2 | tested | T2 | — |
| R3 | uncovered | T3 | At least one required check or decision is missing. |

## Cleanup

not\_applicable: Illustrative document. No application was used to create this example.

## Usage

| Stage | Input tokens | Cache read / write | Output tokens | Peak context | Cost (USD) | Cost source |
| --- | --- | --- | --- | --- | --- | --- |
| plan (revision 1) | not measured | — | — | — | — | — |
| revise (revision 2) | not measured | — | — | — | — | — |
| execute (run-1) | not measured | — | — | — | — | — |

No stage was measured. A stage run in the agent's own session has no usage record.

<details>
<summary>Complete JSON record</summary>

```json
{
  "contractVersion": "toolkit-2",
  "requestId": "execute-1",
  "runId": "run-1",
  "completion": "completed",
  "plan": {
    "path": "plans/checkout/v2.json",
    "sha256": "e98fd465626ea176c66c6dc24f573639cced18d610249c46cc1a6b27bfde5d28"
  },
  "target": {
    "path": "profile.json",
    "sha256": "d071d6df7d0308cf1a0de2a6bf87216531a03ec63764441a042003becff37717"
  },
  "applicationBuild": "fixture-build-1",
  "host": {
    "name": "example-host",
    "version": "1.0.0",
    "model": "example-model",
    "source": "declared",
    "permissions": "session"
  },
  "selectedTestIds": [
    "T1",
    "T2"
  ],
  "startedAt": "2026-11-07T14:24:25.788Z",
  "tests": [
    {
      "testId": "T1",
      "outcome": "passed",
      "expected": "The order total is 400 PLN.",
      "observed": "Order confirmed: 400 PLN",
      "assertionKind": "agent_observation",
      "evidenceIds": [
        "E-T1"
      ],
      "reason": null
    },
    {
      "testId": "T2",
      "outcome": "failed",
      "expected": "HTTP 200 and totalPLN equals 240, with the loyalty discount replaced.",
      "observed": "HTTP 200; totalPLN = 220",
      "assertionKind": "deterministic",
      "evidenceIds": [
        "E-T2"
      ],
      "reason": "Observed total differs from expected total."
    },
    {
      "testId": "T3",
      "outcome": "not_run",
      "expected": null,
      "observed": null,
      "assertionKind": null,
      "evidenceIds": [],
      "reason": "Test was not selected or was deferred."
    }
  ],
  "findings": [
    {
      "id": "F1",
      "type": "defect",
      "severity": "medium",
      "testIds": [
        "T2"
      ],
      "requirementIds": [
        "R2"
      ],
      "title": "Promotion stacks with loyalty",
      "expected": "240 PLN",
      "observed": "220 PLN",
      "reproduction": [
        "Create a 400 PLN cart with 20 PLN loyalty.",
        "Apply a 40 percent promotion.",
        "Read the quote total."
      ],
      "evidenceIds": [
        "E-T2"
      ]
    }
  ],
  "newGaps": [],
  "evidence": [
    {
      "id": "E-T1",
      "kind": "observation",
      "path": "evidence/T1.txt",
      "sha256": "defae3129c5e2095b2a6580118f56b824b9002714c9577730592317d1b8b8179"
    },
    {
      "id": "E-T2",
      "kind": "observation",
      "path": "evidence/T2.txt",
      "sha256": "86f68eb060aca6d97061d59ce146a5dc2cd1f7a90c0ceaff465ff74ade9bd067"
    }
  ],
  "cleanup": {
    "status": "not_applicable",
    "reason": "Illustrative document. No application was used to create this example."
  },
  "finishedAt": "2026-11-07T14:24:25.850Z",
  "coverage": {
    "status": "partial",
    "requirements": [
      {
        "requirementId": "R1",
        "status": "tested",
        "testIds": [
          "T1"
        ],
        "reason": null
      },
      {
        "requirementId": "R2",
        "status": "tested",
        "testIds": [
          "T2"
        ],
        "reason": null
      },
      {
        "requirementId": "R3",
        "status": "uncovered",
        "testIds": [
          "T3"
        ],
        "reason": "At least one required check or decision is missing."
      }
    ]
  },
  "usage": null
}
```

</details>
