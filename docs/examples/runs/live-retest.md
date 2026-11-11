# Test result: live-retest

Generated from the Checkmate database. Completion, test outcomes, and coverage are separate. Use checkmate evidence get to read evidence.

| Field | Value |
| --- | --- |
| Completion | completed |
| Coverage | partial |
| Run | live-retest |
| Application build | fixture-build-2 |
| Plan | checkout@2 |
| Target profile | checkout-local@1 |
| Started | 2026-11-11T12:41:36.250Z |
| Finished | 2026-11-11T12:42:17.363Z |
| Attempts | 1 |
| Retest of | live-run |
| Result digest | 0c821fad4c3add5eb8f410e5d5f4ce7a37d07f2a90f505a537b90604600707cb |

## Tests

| Test | Outcome | Reason |
| --- | --- | --- |
| T1 | not\_run | Test was not selected. |
| T2 | passed | — |
| T3 | passed | — |
| T4 | not\_run | Test was not selected. |

## Assertions

| Assertion | Result | Oracle | Check | Observed | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T2.A1 | passed | deterministic | The quoted total is 240 PLN. | GET /quote?promotion=true returned HTTP 200 with totalPLN 240. | — | T2-A1.json (01M75A2EYDGEKF4P8XY3M2G4VS) |
| T3.A1 | passed | deterministic | totalPLN equals 240. | GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 240. | — | T3-A1.json (01M75A2F3XDVYTHDMT4CVPC9A1) |

## Findings

No findings.

## New gaps

No new gaps.

## Evidence

| Evidence | Assertion | Kind | Name | Media type | Size | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 01M75A2EYDGEKF4P8XY3M2G4VS | T2.A1 | http\_exchange | T2-A1.json | application/json | 75 | d174a7fda088739ac99d133f49051808909d140fe537e5e9bdc52b86c59ae82d |
| 01M75A2F3XDVYTHDMT4CVPC9A1 | T3.A1 | http\_exchange | T3-A1.json | application/json | 88 | b0551a4f470897302414f391a50520fcc3d5eaee966929bfc98be5ff27fd5608 |

## Coverage

| Requirement | Status | Tests | Reason |
| --- | --- | --- | --- |
| R1 | uncovered | T1 | At least one required check or decision is missing. |
| R2 | tested | T2, T3 | — |
| R3 | uncovered | T4 | At least one required check or decision is missing. |

## Cleanup

completed: Browser session was not opened; quote checks were HTTP GET requests that create no records. No records to clean up.

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
    "sha256": "db79cfb64c1c8e00f35b23fe84e3bdb06d2f060c436f461278afff9be886d63f"
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
            "01M75A2F3XDVYTHDMT4CVPC9A1"
          ],
          "observed": "GET /quote?promotion=true&loyalty=true returned HTTP 200 with totalPLN 240.",
          "oracleKind": "deterministic",
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
