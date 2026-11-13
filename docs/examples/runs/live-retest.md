# Test report: live-retest

checkout@2 on build fixture-build-2. Generated from the Checkmate database. Completion, test outcomes, and coverage are separate.

- **Completion:** completed
- **Coverage:** partial
- **Acceptance:** pending
- **Selected tests:** 2
- **passed:** 2
- **Assertions passed:** 2 of 2
- **Findings:** 0
- **New gaps:** 0

## Summary

| Field | Value |
| --- | --- |
| Run | live-retest |
| Objective | Verify checkout totals and identify missing acceptance decisions. |
| Application build | fixture-build-2 |
| Plan | checkout@2 |
| Target profile | checkout-local@1 |
| Started | 2026-11-11T12:41:36.250Z |
| Finished | 2026-11-11T12:42:17.363Z |
| Attempts | 1 |
| Retest of | live-run |
| Cleanup | completed: Browser session was not opened; quote checks were HTTP GET requests that create no records. No records to clean up. |
| Result digest | f4f6fe943e07bb3fdc282d6961a68dd4dc282516b7aeaa3583d040ffff81b326 |

## Acceptance

No decision yet.

## Tests

| Test | Outcome | Assertions | Reason |
| --- | --- | --- | --- |
| T2 | passed | 1 of 1 passed | — |
| T3 | passed | 1 of 1 passed | — |

## Assertions

| Assertion | Result | Check kind | Check | Observed | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T2.A1 | passed | deterministic | The quoted total is 240 PLN. | GET /quote?promotion=true returned HTTP 200 with totalPLN 240. | — | T2-A1.json (01M75A2EYDGEKF4P8XY3M2G4VS) |
| T3.A1 | passed | deterministic | totalPLN equals 240. | GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 240. | — | T3-A1.json (01M75A2F3XDVYTHDMT4CVPC9A1) |

## Findings

No findings.

## New gaps

No new gaps.

## Plan gaps and decisions (checkout@2)

| Gap | Severity | Status | Question | Decision | Value | Actor | Rationale |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | blocking | resolved | Does the 40 percent promotion stack with the 20 PLN loyalty discount, and what is the expected total? | clarify | The promotion replaces the loyalty discount. With the promotion and loyalty, the quote total is 240 PLN. | acceptance-test | Product owner decision. |
| G2 | blocking | deferred | Which orders qualify for a refund, and under what conditions? | defer | Refunds are out of scope for this release. | acceptance-test | Product owner decision. |

## Evidence

- T2.A1: T2-A1.json (application/json, 75 bytes)

  ```
  {"method":"GET","path":"/quote?promotion=true","status":200,"totalPLN":240}
  ```
- T3.A1: T3-A1.json (application/json, 88 bytes)

  ```
  {"method":"GET","path":"/quote?promotion=true&loyalty=true","status":200,"totalPLN":240}
  ```

| Evidence | Assertion | Kind | Name | Media type | Size | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 01M75A2EYDGEKF4P8XY3M2G4VS | T2.A1 | http\_exchange | T2-A1.json | application/json | 75 | d174a7fda088739ac99d133f49051808909d140fe537e5e9bdc52b86c59ae82d |
| 01M75A2F3XDVYTHDMT4CVPC9A1 | T3.A1 | http\_exchange | T3-A1.json | application/json | 88 | b0551a4f470897302414f391a50520fcc3d5eaee966929bfc98be5ff27fd5608 |

## Coverage

| Requirement | Text | Status | Tests | Reason |
| --- | --- | --- | --- | --- |
| R1 | A standard order for one 400 PLN item has a total of 400 PLN. | uncovered | T1 | At least one required check or decision is missing. |
| R2 | A 40 percent promotion applies to the order. The brief does not say if it stacks with the 20 PLN loyalty discount. | tested | T2, T3 | — |
| R3 | Customers can request refunds. The brief does not say which orders qualify. | uncovered | T4 | At least one required check or decision is missing. |

<details>
<summary>Complete JSON record</summary>

```json
{
  "applicationBuild": "fixture-build-2",
  "attempts": 1,
  "cleanup": {
    "reason": "Browser session was not opened; quote checks were HTTP GET requests that create no records. No records to clean up.",
    "status": "completed"
  },
  "completion": "completed",
  "contractVersion": "toolkit-2",
  "coverage": {
    "requirements": [
      {
        "reason": "At least one required check or decision is missing.",
        "requirementId": "R1",
        "status": "uncovered",
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
      "id": "01M75A2EYDGEKF4P8XY3M2G4VS",
      "kind": "http_exchange",
      "mediaType": "application/json",
      "name": "T2-A1.json",
      "sha256": "d174a7fda088739ac99d133f49051808909d140fe537e5e9bdc52b86c59ae82d",
      "size": 75,
      "testId": "T2"
    },
    {
      "assertionId": "A1",
      "id": "01M75A2F3XDVYTHDMT4CVPC9A1",
      "kind": "http_exchange",
      "mediaType": "application/json",
      "name": "T3-A1.json",
      "sha256": "b0551a4f470897302414f391a50520fcc3d5eaee966929bfc98be5ff27fd5608",
      "size": 88,
      "testId": "T3"
    }
  ],
  "findings": [],
  "finishedAt": "2026-11-11T12:42:17.363Z",
  "newGaps": [],
  "plan": {
    "planId": "checkout",
    "revision": 2,
    "sha256": "b3617b84dc5be5db9d388e241102127d41383f924ec1063570ec8aa0f194a28d"
  },
  "retestOf": "live-run",
  "runId": "live-retest",
  "selectedTestIds": [
    "T2",
    "T3"
  ],
  "startedAt": "2026-11-11T12:41:36.250Z",
  "target": {
    "revision": 1,
    "sha256": "b031a78b1d2fdd2774eeef470b5f8a47101a4be1c2c867a684c0e622e9fe637b",
    "targetId": "checkout-local"
  },
  "tests": [
    {
      "assertions": [],
      "outcome": "not_run",
      "reason": "Test was not selected.",
      "testId": "T1"
    },
    {
      "assertions": [
        {
          "assertionId": "A1",
          "check": "The quoted total is 240 PLN.",
          "evidenceIds": [
            "01M75A2EYDGEKF4P8XY3M2G4VS"
          ],
          "observed": "GET /quote?promotion=true returned HTTP 200 with totalPLN 240.",
          "checkKind": "deterministic",
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
            "01M75A2F3XDVYTHDMT4CVPC9A1"
          ],
          "observed": "GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 240.",
          "checkKind": "deterministic",
          "reason": null,
          "result": "passed"
        }
      ],
      "outcome": "passed",
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
