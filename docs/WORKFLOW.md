# Workflow

This example tests a local checkout. Run the `checkmate` commands in the application workspace. Run the `/checkmate:` skills in Claude Code in the same workspace.

1. Set your name for the record:

   ```sh
   export CHECKMATE_ACTOR=qa-lead
   ```

2. Open a target and set it up:

   ```sh
   checkmate target open checkout-local --base-url http://127.0.0.1:4173 \
     --capabilities browser,http --operations read_catalog,create_fixture_order,apply_fixture_discount
   ```

   ```text
   /checkmate:setup checkout-local
   ```

   The skill checks the tools and the target, and saves profile `checkout-local@1`.

3. Open a plan and let Claude write it. `plan-request.json` has the objective, requirements, and source context ([example](CONFIGURATION.md#plan-request)).

   ```sh
   checkmate plan open checkout --target checkout-local@1 < plan-request.json
   ```

   ```text
   /checkmate:plan checkout
   ```

   The result is `needs_decision` when a requirement is unclear. Each unclear item is an open blocking gap, for example `G1: Does the 40 percent promotion stack with the 20 PLN loyalty discount?`

4. Answer the gaps, and let Claude apply the decisions:

   ```sh
   checkmate gap answer checkout G1 --kind clarify --source decisions#promotion \
     --value "The promotion replaces the loyalty discount. The quote total is 240 PLN." \
     --rationale "Product owner decision."
   checkmate gap answer checkout G2 --kind defer \
     --value "Refunds are out of scope for this release." --rationale "Product owner decision."
   ```

   ```text
   /checkmate:revise checkout
   ```

5. Read and approve the new revision:

   ```sh
   checkmate plan show checkout@2 --fields readiness,assertions
   checkmate plan approve checkout@2 --rationale "Tests and assertions match the brief."
   ```

6. Execute the plan:

   ```text
   /checkmate:execute checkout@2, tests T1,T2,T3, build fixture-build-1, run ID run-1
   ```

   In the same session, the skill runs `checkmate run gate` and `checkmate run begin`. Then it records each assertion with evidence, closes each test, records findings, and finishes the run.

7. Review and accept the result:

   ```sh
   checkmate run show run-1
   checkmate result accept run-1 --rationale "The defect in T3 is real. Fix before release."
   ```

   You can also make every decision in the review UI:

   ```sh
   checkmate ui
   ```

## CI and scripts

`checkmate delegate` runs one stage in a fresh Claude Code session. Open the subject first, then delegate:

```sh
checkmate target open checkout-local --base-url "$BASE_URL" --capabilities browser,http \
  --operations read_catalog,create_fixture_order,apply_fixture_discount
checkmate delegate setup checkout-local --allow Read --allow Write --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
checkmate plan open checkout --target checkout-local@1 < plan-request.json
checkmate delegate plan checkout --allow Read --allow Write --allow "Bash(node *)"
# A human answers the gaps and approves checkout@2.
checkmate run begin run-7 checkout@2 --tests T1,T2,T3 --build "$GIT_SHA"
checkmate delegate execute run-7 --allow Read --allow Write --allow "Bash(node *)" --allow "Bash(playwright-cli *)"
```

The parent does not trust the worker's words. It reads the database and returns the recorded result. Read [CLI](CLI.md) for the stages, permissions, and deadlines.
