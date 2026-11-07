# Test result

Completion and coverage are separate. Inspect each test outcome.

```json
{
  "contractVersion": "toolkit-1",
  "requestId": "execute-1",
  "runId": "run-1",
  "completion": "completed",
  "plan": {
    "path": "plans/checkout/v2.json",
    "sha256": "ef15b530201bdc683341ecb0a704903d6e7eef2ab550f7df8fe3f98e7ad2c194"
  },
  "target": {
    "path": "profile.json",
    "sha256": "d2c76c324a66b6fabf788ac059d556a62204edf68d0472f2c982e2368962da70"
  },
  "applicationBuild": "fixture-build-1",
  "selectedTestIds": [
    "T1",
    "T2"
  ],
  "startedAt": "2026-11-07T14:24:25.788Z",
  "tests": [
    {
      "testId": "T1",
      "outcome": "passed",
      "expected": "The order total is 100 PLN.",
      "observed": "Order confirmed: 100 PLN",
      "assertionKind": "agent_observation",
      "evidenceIds": [
        "E-T1"
      ],
      "reason": null
    },
    {
      "testId": "T2",
      "outcome": "failed",
      "expected": "HTTP 200 and totalPLN equals 90, with the loyalty discount replaced.",
      "observed": "HTTP 200; totalPLN = 85",
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
      "expected": "90 PLN",
      "observed": "85 PLN",
      "reproduction": [
        "Create a 100 PLN cart with 5 PLN loyalty.",
        "Apply a 10 percent promotion.",
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
      "sha256": "fa3a45444d201a31e6e94f5e2f15120fd0518c893b533db779d6f17f4341ee60"
    },
    {
      "id": "E-T2",
      "kind": "observation",
      "path": "evidence/T2.txt",
      "sha256": "a7605959105b8b69cfc226cfb2192dd2ec682fbba7ec47597796a09acd2315b3"
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
  }
}
```
