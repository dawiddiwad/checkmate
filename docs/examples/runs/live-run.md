# Test result: live-run

Generated from the Checkmate database. Completion, test outcomes, and coverage are separate. Use checkmate evidence get to read evidence.

| Field | Value |
| --- | --- |
| Completion | completed |
| Coverage | partial |
| Run | live-run |
| Application build | fixture-build-1 |
| Plan | checkout@2 |
| Target profile | checkout-local@1 |
| Started | 2026-11-11T12:40:47.717Z |
| Finished | 2026-11-11T12:41:29.370Z |
| Attempts | 1 |
| Retest of | — |
| Result digest | ebf419350e0f97cf2676fce3e88e51005501138d7649432f217cf23e54b9ab47 |

## Tests

| Test | Outcome | Reason |
| --- | --- | --- |
| T1 | passed | — |
| T2 | passed | — |
| T3 | failed | — |
| T4 | not\_run | Test was not selected. |

## Assertions

| Assertion | Result | Oracle | Check | Observed | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1.A1 | passed | deterministic | The order total is 400 PLN. | Order confirmed: 400 PLN shown after Complete checkout | — | T1-A1.txt (01M75A0MHETEGDTJKJA4R95CGZ) |
| T2.A1 | passed | deterministic | The quoted total is 240 PLN. | GET /quote?promotion=true status 200 totalPLN 240 | — | T2-A1.json (01M75A0T5N9Q5D2QN7FZRQ34Y7) |
| T3.A1 | failed | deterministic | totalPLN equals 240. | GET /quote?promotion=true&loyalty=true status 200 totalPLN 220; expected 240 | — | T3-A1.json (01M75A0ZVZC156GNSTPZ9G4MYX) |

## Findings

### F1 · defect · medium: Loyalty discount does not stack with promotion in quote

| Field | Value |
| --- | --- |
| Assertions | T3.A1 |
| Requirements | R2 |
| Expected | totalPLN equals 240. |
| Observed | GET /quote?promotion=true&loyalty=true returned status 200 with totalPLN 220. |
| Evidence | T3-A1.json (01M75A0ZVZC156GNSTPZ9G4MYX) |

1. GET /quote?promotion=true&loyalty=true

## New gaps

No new gaps.

## Evidence

| Evidence | Assertion | Kind | Name | Media type | Size | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 01M75A0MHETEGDTJKJA4R95CGZ | T1.A1 | observation | T1-A1.txt | text/plain | 96 | 747bc1d482cf7e0b537e9fccd23abc229b3b6b3b0bf3c3223ea100bc10da4a87 |
| 01M75A0T5N9Q5D2QN7FZRQ34Y7 | T2.A1 | http\_exchange | T2-A1.json | application/json | 60 | d87beb454e1f63bea4102fa83fe980eb6fd12e53e15b7235f5e2c2c90a96f39e |
| 01M75A0ZVZC156GNSTPZ9G4MYX | T3.A1 | http\_exchange | T3-A1.json | application/json | 60 | 74046dcf7859e9370f5269411b40719c710f28157da2a48ef867a5115ccdd548 |

## Coverage

| Requirement | Status | Tests | Reason |
| --- | --- | --- | --- |
| R1 | tested | T1 | — |
| R2 | tested | T2, T3 | — |
| R3 | uncovered | T4 | At least one required check or decision is missing. |

## Cleanup

completed: Browser session closed; fixture stores no records, no cleanup required.

<details>
<summary>Complete JSON record</summary>

```json
{
  "applicationBuild": "fixture-build-1",
  "attempts": 1,
  "cleanup": {
    "reason": "Browser session closed; fixture stores no records, no cleanup required.",
    "status": "completed"
  },
  "completion": "completed",
  "contractVersion": "toolkit-2",
  "coverage": {
    "requirements": [
      {
        "reason": null,
        "requirementId": "R1",
        "status": "tested",
        "testIds": [
          "T1"
        ]
      },
      {
        "reason": null,
        "requirementId": "R2",
        "status": "tested",
        "testIds": [
          "T2",
          "T3"
        ]
      },
      {
        "reason": "At least one required check or decision is missing.",
        "requirementId": "R3",
        "status": "uncovered",
        "testIds": [
          "T4"
        ]
      }
    ],
    "status": "partial"
  },
  "evidence": [
    {
      "assertionId": "A1",
      "id": "01M75A0MHETEGDTJKJA4R95CGZ",
      "kind": "observation",
      "mediaType": "text/plain",
      "name": "T1-A1.txt",
      "sha256": "747bc1d482cf7e0b537e9fccd23abc229b3b6b3b0bf3c3223ea100bc10da4a87",
      "size": 96,
      "testId": "T1"
    },
    {
      "assertionId": "A1",
      "id": "01M75A0T5N9Q5D2QN7FZRQ34Y7",
      "kind": "http_exchange",
      "mediaType": "application/json",
      "name": "T2-A1.json",
      "sha256": "d87beb454e1f63bea4102fa83fe980eb6fd12e53e15b7235f5e2c2c90a96f39e",
      "size": 60,
      "testId": "T2"
    },
    {
      "assertionId": "A1",
      "id": "01M75A0ZVZC156GNSTPZ9G4MYX",
      "kind": "http_exchange",
      "mediaType": "application/json",
      "name": "T3-A1.json",
      "sha256": "74046dcf7859e9370f5269411b40719c710f28157da2a48ef867a5115ccdd548",
      "size": 60,
      "testId": "T3"
    }
  ],
  "findings": [
    {
      "assertionIds": [
        "T3.A1"
      ],
      "evidenceIds": [
        "01M75A0ZVZC156GNSTPZ9G4MYX"
      ],
      "expected": "totalPLN equals 240.",
      "id": "F1",
      "observed": "GET /quote?promotion=true&loyalty=true returned status 200 with totalPLN 220.",
      "reproduction": [
        "GET /quote?promotion=true&loyalty=true"
      ],
      "requirementIds": [
        "R2"
      ],
      "severity": "medium",
      "testIds": [
        "T3"
      ],
      "title": "Loyalty discount does not stack with promotion in quote",
      "type": "defect"
    }
  ],
  "finishedAt": "2026-11-11T12:41:29.370Z",
  "newGaps": [],
  "plan": {
    "planId": "checkout",
    "revision": 2,
    "sha256": "db79cfb64c1c8e00f35b23fe84e3bdb06d2f060c436f461278afff9be886d63f"
  },
  "retestOf": null,
  "runId": "live-run",
  "selectedTestIds": [
    "T1",
    "T2",
    "T3"
  ],
  "startedAt": "2026-11-11T12:40:47.717Z",
  "target": {
    "revision": 1,
    "sha256": "b031a78b1d2fdd2774eeef470b5f8a47101a4be1c2c867a684c0e622e9fe637b",
    "targetId": "checkout-local"
  },
  "tests": [
    {
      "assertions": [
        {
          "assertionId": "A1",
          "check": "The order total is 400 PLN.",
          "evidenceIds": [
            "01M75A0MHETEGDTJKJA4R95CGZ"
          ],
          "observed": "Order confirmed: 400 PLN shown after Complete checkout",
          "oracleKind": "deterministic",
          "reason": null,
          "result": "passed"
        }
      ],
      "outcome": "passed",
      "reason": null,
      "testId": "T1"
    },
    {
      "assertions": [
        {
          "assertionId": "A1",
          "check": "The quoted total is 240 PLN.",
          "evidenceIds": [
            "01M75A0T5N9Q5D2QN7FZRQ34Y7"
          ],
          "observed": "GET /quote?promotion=true status 200 totalPLN 240",
          "oracleKind": "deterministic",
          "reason": null,
          "result": "passed"
        }
      ],
      "outcome": "passed",
      "reason": null,
      "testId": "T2"
    },
    {
      "assertions": [
        {
          "assertionId": "A1",
          "check": "totalPLN equals 240.",
          "evidenceIds": [
            "01M75A0ZVZC156GNSTPZ9G4MYX"
          ],
          "observed": "GET /quote?promotion=true&loyalty=true status 200 totalPLN 220; expected 240",
          "oracleKind": "deterministic",
          "reason": null,
          "result": "failed"
        }
      ],
      "outcome": "failed",
      "reason": null,
      "testId": "T3"
    },
    {
      "assertions": [],
      "outcome": "not_run",
      "reason": "Test was not selected.",
      "testId": "T4"
    }
  ]
}
```

</details>
