# Test plan: checkout revision 1

Generated from the Checkmate database. Record a decision and revise the plan to change it.

| Field | Value |
| --- | --- |
| Plan | checkout |
| Revision | 1 |
| Previous revision | — |
| Target | checkout-local@1 |
| Objective | Verify checkout totals and identify missing acceptance decisions. |
| Plan digest | 8132749996918d004df639387549a5cc3cb8a268684b37470f61a202a0cf3167 |

## Requirements

| Requirement | Text | Source | Coverage |
| --- | --- | --- | --- |
| R1 | A standard order for one 400 PLN item has a total of 400 PLN. | brief#standard | planned |
| R2 | A 40 percent promotion applies to the order. The brief does not say if it stacks with the 20 PLN loyalty discount. | brief#promotion | blocked |
| R3 | Customers can request refunds. The brief does not say which orders qualify. | brief#refund | blocked |

## Tests

| Test | Title | Readiness | Requirements | Depends on | Preconditions | Action |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Standard order total | ready | R1 | — | Fresh cart with one 400 PLN item. | Complete checkout on / and read the order total. |
| T2 | Promotion alone applies 40 percent | ready | R2 | — | Cart with one 400 PLN item., Promotion applied, loyalty not applied. | Request the quote with the promotion and without loyalty. |
| T3 | Promotion stacked with loyalty discount | blocked | R2 | — | Cart with one 400 PLN item., Promotion and 20 PLN loyalty applied. | Request GET /quote?promotion=true&loyalty=true and read the total. |
| T4 | Refund eligibility | blocked | R3 | — | A completed order exists. | Determine which orders qualify for a refund. |

## Assertions

| Assertion | Oracle | Check |
| --- | --- | --- |
| T1.A1 | deterministic | The order total is 400 PLN. |
| T2.A1 | deterministic | The quoted total is 240 PLN. |

## Gaps

| Gap | Severity | Status | Question | Consequence | Decision |
| --- | --- | --- | --- | --- | --- |
| G1 | blocking | open | Does the 40 percent promotion stack with the 20 PLN loyalty discount, and what is the expected total? | The expected total for the combined discounts is unknown, so T3 cannot assert a value. | — |
| G2 | blocking | open | Which orders qualify for a refund, and under what conditions? | The refund expectations are unknown, so T4 cannot assert a value. | — |

## Decisions

No decisions.

## Assumptions

No accepted assumptions.

<details>
<summary>Complete JSON record</summary>

```json
{
  "assumptions": [],
  "contractVersion": "toolkit-2",
  "coverage": [
    {
      "requirementId": "R1",
      "status": "planned",
      "testIds": [
        "T1"
      ]
    },
    {
      "requirementId": "R2",
      "status": "blocked",
      "testIds": [
        "T2",
        "T3"
      ]
    },
    {
      "requirementId": "R3",
      "status": "blocked",
      "testIds": [
        "T4"
      ]
    }
  ],
  "decisions": [],
  "gaps": [
    {
      "consequence": "The expected total for the combined discounts is unknown, so T3 cannot assert a value.",
      "decisionId": null,
      "id": "G1",
      "question": "Does the 40 percent promotion stack with the 20 PLN loyalty discount, and what is the expected total?",
      "requirementIds": [],
      "severity": "blocking",
      "status": "open",
      "testIds": [
        "T3"
      ]
    },
    {
      "consequence": "The refund expectations are unknown, so T4 cannot assert a value.",
      "decisionId": null,
      "id": "G2",
      "question": "Which orders qualify for a refund, and under what conditions?",
      "requirementIds": [
        "R3"
      ],
      "severity": "blocking",
      "status": "open",
      "testIds": []
    }
  ],
  "objective": "Verify checkout totals and identify missing acceptance decisions.",
  "planId": "checkout",
  "previousRevision": null,
  "requirements": [
    {
      "id": "R1",
      "source": "brief#standard",
      "text": "A standard order for one 400 PLN item has a total of 400 PLN."
    },
    {
      "id": "R2",
      "source": "brief#promotion",
      "text": "A 40 percent promotion applies to the order. The brief does not say if it stacks with the 20 PLN loyalty discount."
    },
    {
      "id": "R3",
      "source": "brief#refund",
      "text": "Customers can request refunds. The brief does not say which orders qualify."
    }
  ],
  "revision": 1,
  "target": {
    "revision": 1,
    "sha256": "b031a78b1d2fdd2774eeef470b5f8a47101a4be1c2c867a684c0e622e9fe637b",
    "targetId": "checkout-local"
  },
  "tests": [
    {
      "action": "Complete checkout on / and read the order total.",
      "assertions": [
        {
          "check": "The order total is 400 PLN.",
          "id": "A1",
          "oracleKind": "deterministic"
        }
      ],
      "capability": "browser",
      "dependsOn": [],
      "gapIds": [],
      "id": "T1",
      "operations": [
        "create_fixture_order"
      ],
      "preconditions": [
        "Fresh cart with one 400 PLN item."
      ],
      "readiness": "ready",
      "requirementIds": [
        "R1"
      ],
      "title": "Standard order total"
    },
    {
      "action": "Request the quote with the promotion and without loyalty.",
      "assertions": [
        {
          "check": "The quoted total is 240 PLN.",
          "id": "A1",
          "oracleKind": "deterministic"
        }
      ],
      "capability": "http",
      "dependsOn": [],
      "gapIds": [],
      "id": "T2",
      "operations": [
        "apply_fixture_discount"
      ],
      "preconditions": [
        "Cart with one 400 PLN item.",
        "Promotion applied, loyalty not applied."
      ],
      "readiness": "ready",
      "requirementIds": [
        "R2"
      ],
      "title": "Promotion alone applies 40 percent"
    },
    {
      "action": "Request GET /quote?promotion=true&loyalty=true and read the total.",
      "assertions": [],
      "capability": "http",
      "dependsOn": [],
      "gapIds": [
        "G1"
      ],
      "id": "T3",
      "operations": [
        "apply_fixture_discount"
      ],
      "preconditions": [
        "Cart with one 400 PLN item.",
        "Promotion and 20 PLN loyalty applied."
      ],
      "readiness": "blocked",
      "requirementIds": [
        "R2"
      ],
      "title": "Promotion stacked with loyalty discount"
    },
    {
      "action": "Determine which orders qualify for a refund.",
      "assertions": [],
      "capability": "http",
      "dependsOn": [],
      "gapIds": [
        "G2"
      ],
      "id": "T4",
      "operations": [
        "read_catalog"
      ],
      "preconditions": [
        "A completed order exists."
      ],
      "readiness": "blocked",
      "requirementIds": [
        "R3"
      ],
      "title": "Refund eligibility"
    }
  ]
}
```

</details>
