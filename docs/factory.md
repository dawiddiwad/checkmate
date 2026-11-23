# Use Checkmate from a factory

Use the npm CLI when a factory controls ticket intake, builds, and QA stages.

| Role           | Owns                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| Oracle         | Answers, plan approvals, result decisions, and promotion.                         |
| Planner and QA | Draft tests, run them, and record observations and evidence.                      |
| Factory        | Checks out code, builds it, starts and resets the application, and fixes defects. |
| Host           | Models, credentials, tools, and permissions.                                      |
| Checkmate      | The shared SQLite record and workflow gates.                                      |

When asked, Checkmate starts workers through the configured host. It does not check out code or start the application. Host permissions remain in the host. Checkmate gates use the records; they are not an operating-system sandbox.

## Before you start

- Use Node.js 24.12.0 or later and install the CLI with `npm install -g @xoxoai/checkmate`.
- Run commands in the workspace that contains `.checkmate/checkmate.db`, or pass `--workspace <path>`.
- Configure Claude Code or Pi on `PATH` for delegated stages.
- Install Playwright CLI when a test uses a browser.
- Give `delegate` the tools that the stage needs. The host enforces those permissions.

For Claude Code, use `--allow` for each required tool. For Pi, set `CHECKMATE_HARNESS=pi` and omit `--allow` and `--claude-arg` from delegate commands.

Read [CLI and record reference](reference.md) for global options and exact command forms. Check `checkmate --help` for the installed version.

## Prepare a target profile

Create and save a profile once for the intended capabilities. This example needs no running instance. Change its operations and approval policy for your application.

```sh
checkmate target open shop --entry-point "web:url:Shop API." \
  --capabilities http --operations read_catalog
checkmate target save shop <<'JSON'
{
  "contractVersion":"toolkit-2", "targetId":"shop", "revision":1,
  "entryPoints":[{"name":"web","kind":"url","purpose":"Shop API."}],
  "capabilities":["http"], "tools":[],
  "authentication":{"kind":"none","references":[]},
  "allowedOperations":["read_catalog"],
  "startup":{"owner":"factory","command":null}, "cleanup":"No test data.",
  "readyForLiveExecution":true, "approvals":{"plan":"required","result":"required"}
}
JSON
```

## Mode 1: review a ticket before a build

Use this mode when the oracle needs to review requirements before an application or instance exists. Keep each source as a readable local file. This mode records specification evidence; it does not test a running application.

The target profile describes intended capabilities and operations. Its `readyForLiveExecution` value does not start or verify an application. Add an actual instance only after the factory builds and starts the application.

1. [Prepare a target profile](#prepare-a-target-profile). Do not add an instance yet.

2. Save a local ticket source:

   ```sh
   printf '%s\n' 'The promotion quote is 240 PLN. Does it replace loyalty?' > ticket.md
   ```

3. Open a plan for the ticket:

   ```sh
   checkmate plan open SHOP-12 --target shop@1 \
     --objective "Check the promotion quote." --source ticket.md
   ```

4. Save the rules, draft test, and open question:

   ```sh
   checkmate plan save SHOP-12 <<'JSON'
   {
     "requirements":[{"id":"R1","text":"The promotion quote is 240 PLN.","source":"ticket.md"}],
     "tests":[{"id":"T1","title":"Promotion quote","requirementIds":["R1"],
       "capability":"http","operations":["read_catalog"],"dependsOn":[],"preconditions":[],
       "action":"Read the promotion quote.",
       "assertions":[{"id":"A1","check":"The quote is 240 PLN.","checkKind":"deterministic"}]}],
     "gaps":[{"id":"G1","severity":"blocking","status":"open","requirementIds":["R1"],
       "testIds":["T1"],"question":"Does it replace loyalty?",
       "consequence":"The combined quote is unclear.","decisionId":null}]
   }
   JSON
   ```

5. Review the local ticket source.
6. Run a tool-free delegated review:

   ```sh
   checkmate delegate spec SHOP-12@1
   ```

   The delegated reviewer receives the current source files, plan revision, and applied oracle answers. It has no tools or application instance. It can record source-backed questions, gaps, and specification defects. It cannot answer, approve, or hand off.

   To review without a delegated model, record a source-backed finding and review. A finding must name an open gap and quote a local source. Use the current plan digest for both commands:

   ```sh
   SHA=$(checkmate plan show SHOP-12@1 --json | node -pe "JSON.parse(require('fs').readFileSync(0)).sha256")
   checkmate spec finding SHOP-12@1 G1 --kind question --source ticket.md \
     --evidence "Does it replace loyalty?" --expect-sha "$SHA"
   checkmate spec review SHOP-12@1 --source ticket.md \
     --evidence "Does it replace loyalty?" \
     --rationale "Reviewed the ticket and its open question." --expect-sha "$SHA"
   ```

7. Read the review status:

   ```sh
   checkmate spec status SHOP-12@1 --json
   ```

8. Answer the question:

   ```sh
   checkmate gap answer SHOP-12 G1 --kind clarify --source ticket.md \
     --value "The promotion replaces loyalty." --rationale "Product owner decision."
   ```

9. Apply the answer in a new revision. For this example, the existing assertion already covers the answer:

   ```sh
   checkmate plan revise SHOP-12 <<'JSON'
   {"tests":{}}
   JSON
   ```

10. Review the new revision. Use `checkmate delegate spec SHOP-12@2`, or record a human review:

    ```sh
    SHA=$(checkmate plan show SHOP-12@2 --json | node -pe "JSON.parse(require('fs').readFileSync(0)).sha256")
    checkmate spec review SHOP-12@2 --source ticket.md \
      --evidence "Does it replace loyalty?" --rationale "Reviewed the applied answer." --expect-sha "$SHA"
    ```

11. Approve the revision when the target requires approval:

    ```sh
    checkmate plan approve SHOP-12@2 --rationale "Reviewed the resolved rules."
    ```

12. Record the handoff with the current digest:

    ```sh
    SHA=$(checkmate plan show SHOP-12@2 --json | node -pe "JSON.parse(require('fs').readFileSync(0)).sha256")
    checkmate spec handoff SHOP-12@2 --expect-sha "$SHA" \
      --rationale "Reviewed current sources and rules."
    ```

13. Read the handoff status:

    ```sh
    checkmate spec status SHOP-12@2 --json
    ```

The examples use revision 2. Replace it with the actual latest revision. A successful handoff returns `ready=true` and the current digest. The handoff refuses changed sources or revisions, missing current review, unresolved findings, open gaps, uncovered rules, and missing required approval. Correct the cause, review the current revision again, and retry. It does not start a build. Existing build-first commands do not require this optional handoff; the factory must check it before it acts on this mode. After handoff, the factory builds and starts the application. Continue from the instance step in [Mode 2](#mode-2-build-first-retest-and-promote) using the reviewed revision.

When a source is external, keep a local copy before review. Checkmate verifies that evidence quotes match a local source; it does not judge whether the review is correct. Sources must be readable local files of at most 40,000 characters.

## Mode 2: build first, retest, and promote

Use this mode when the oracle can approve the ticket rules before the first build.

1. [Prepare a target profile](#prepare-a-target-profile) when no matching target exists.

2. Save the ticket source in the workspace as `ticket.md`.
3. Open a plan:

   ```sh
   checkmate plan open SHOP-12 --target shop@1 \
     --objective "Check the promotion quote." --source ticket.md
   ```

4. Ask the planner to write the rules and tests:

   ```sh
   checkmate delegate plan SHOP-12 --allow Read --allow Bash
   ```

5. Read the plan and its open gaps with `checkmate status SHOP-12`.
6. Answer each gap that blocks a test.
7. Ask the planner to apply answers in a new revision. Update the current revision number.
8. Approve the latest revision when the target requires approval. Replace `SHOP-12@1` with the revision you reviewed:

   ```sh
   checkmate plan approve SHOP-12@1 --rationale "The ticket rules are correct."
   ```

9. Build the application and start it. Record a unique build ID.
10. Add the running application as an active instance. Replace the example URL with its actual URL:

    ```sh
    checkmate target instance add shop local --entry "web=http://127.0.0.1:4173"
    ```

11. Set the plan ID and latest revision:

    ```sh
    PLAN=SHOP-12
    REV=1
    ```

Replace `shop-build-1` and `shop-build-2` in the commands below with the IDs that the factory assigns to each build.

12. Explore the first build. The host owns tool permissions. For Pi, use its tool names with `--allow`:

    ```sh
    checkmate explore start "$PLAN" --build shop-build-1 --instance local --allow Read --allow Bash
    checkmate explore wait <explorationId>
    ```

    Replace `<explorationId>` with the ID in the start receipt. Resolve open questions before promotion.

13. Start the first run on the first build. Select ready tests when the plan has open gaps:

    ```sh
    checkmate run begin run-1 "$PLAN@$REV" --build shop-build-1 \
      --instance local --partial ready_only
    checkmate delegate execute run-1 --allow Read --allow Bash
    ```

14. Read the first run and its evidence.
15. If the first run found a gap, answer it.
16. If you answered a gap, ask the planner to apply it in a new revision. Update `REV`.
17. Approve the latest revision when the target requires approval.
18. Accept the result when it records what QA observed. This applies even when it records a failure. Acceptance does not mean that the build passed.
19. Give each real defect and its evidence to the factory.
20. Build and start a distinct fixed build. Record its build ID.
21. Retest the open defects and ready regression tests:

    ```sh
    checkmate explore start "$PLAN" --build shop-build-2 --instance local --allow Read --allow Bash
    checkmate explore wait <explorationId>
    checkmate run begin run-2 "$PLAN@$REV" --build shop-build-2 \
      --instance local --partial ready_only --retest-of run-1
    checkmate delegate execute run-2 --allow Read --allow Bash
    checkmate run show run-2
    ```

22. Read the retest result and evidence. Retest any open exploration claims.
    If any test still fails, give the new evidence to the factory. Build another distinct build and repeat the retest with a new run ID. Do not promote a failing run.
23. When every test passes with evidence, accept the result:

    ```sh
    checkmate result accept run-2 --rationale "The fixed build passes the ticket rules."
    ```

24. Promote the passing tests:

    ```sh
    checkmate plan promote "$PLAN@$REV" --run run-2 --build shop-build-2 \
      --rationale "Save these tests for this ticket."
    checkmate plan promotions SHOP-12
    ```

Promotion is an explicit oracle decision. It requires the latest plan revision, the latest recorded build, a completed run on that revision and build, explicit result acceptance, evidence for every assertion, and a passing result for every test. Each rule must have a test. Resolve open gaps, questions, and claims first. One run must cover every test. Do not record another run or exploration before promotion. The promotion creates an immutable snapshot with its tests and provenance.

To retest, use a new run ID and a distinct build. A run does not change the earlier run.

## Mode 3: run only promoted tests

Use permanent mode for recurring QA. The factory builds and starts the application, then gives the run an explicit build ID.

1. List the promotions and choose the exact latest snapshot:

   ```sh
   checkmate plan promotions SHOP-12
   ```

2. Set the promotion ID from that output. This example uses `SHOP-12@5`:

   ```sh
   PROMOTION=SHOP-12@5
   CURRENT_BUILD=shop-build-3
   ```

3. Start the permanent run on the current build:

   ```sh
   checkmate run permanent run-3 SHOP-12 --build "$CURRENT_BUILD" \
     --instance local --promotion "$PROMOTION"
   ```

4. Delegate its execution:

   ```sh
   checkmate delegate execute run-3 --allow Read --allow Bash
   ```

5. Read the run and its selected promotion:

   ```sh
   checkmate run show run-3 --json
   ```

The CLI requires `--build`. `--promotion` is optional; use it to require one exact latest snapshot. Checkmate selects only the immutable tests in the promotion. A later draft cannot change that selection. Permanent mode starts no exploration and creates no discovery gaps or potential-issue findings.

Checkmate refuses a missing, wrong-ticket, stale, empty, rejected, or withdrawn promotion before it starts the run or host. It does not fall back to an older snapshot. A rejected promoted revision or withdrawn source-result acceptance blocks new permanent runs. If the promotion is withdrawn before delegation or resume, Checkmate refuses those actions too. Check `checkmate plan promotions SHOP-12` and fix the current plan or result before you promote again.

A permanent run can record failed assertions and evidence. Use a normal run to check new behavior. Follow Mode 2 to create a new promotion after a fix.

## Read status and recover

Run these commands when the next owner is unclear:

```sh
checkmate status SHOP-12
checkmate inbox
checkmate run show <runId>
```

Follow the `next` lines from status. If a run is still started after a host stop, read the open tests before you resume:

```sh
checkmate run resume <runId>
checkmate delegate execute <runId> --allow Read --allow Bash
```

Resume checks the instance, target profile, and run gate. It records a new attempt and lists the open tests. It does not run test actions. When an action may have changed application data and cannot be checked safely, close that test as `error` with a reason. See [Local human-oracle QA](local-qa.md#review-a-result-and-retry) for the recovery steps.
