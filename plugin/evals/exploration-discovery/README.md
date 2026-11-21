# Exploratory defect discovery

This eval compares bare Pi with Checkmate exploration. All sessions use `openai-codex/gpt-6-luna` at medium effort. Smoke compares one bare tester with one Checkmate tester. Normal compares two independent bare testers with two Checkmate testers in one exploration. Checkmate includes study, testing and recording. Normal can also merge and verify findings.

Harbor Rentals is a local equipment reservation app with a browser desk and HTTP API. Both arms get the same Git repository. Bare testers have separate workspaces. Checkmate testers share one exploration workspace. The active branch contains PR 27 and the full source. Each agent can inspect the base with `git show main:app.mjs` or the PR with `git diff main...HEAD`. Each tester has separate deployed base and PR previews. The previews serve the source from the corresponding Git commits. The fixture and answer key stay outside the agent workspaces.

The base has six existing defects. The PR preserves those defects and introduces six regressions. A deterministic oracle checks all 12 behaviors on the base, PR, and a fixed control. It also checks browser bulk rescheduling and the effect of an invalid batch. The agents get the same product contract, PR text, tool access, and wall-clock limit. Bare Pi gets a short request to explore and report findings. Each Checkmate tester gets a four-minute test turn. The discovery scenario follows the open PR. The core scenario uses regression mode and checks established workflows on both builds. Its task excludes the new bulk flow.

## Run

From the repository root, use Node.js 24, an authenticated Pi host, Chrome, and `playwright-cli`. The Pi host supplies credentials. For the oracle, set `BROWSER_EXECUTABLE` if Chrome is in a nonstandard location.

```sh
node scripts/build-cli.ts
node plugin/evals/exploration-discovery/run.mjs --verify
node plugin/evals/exploration-discovery/run.mjs
node plugin/evals/exploration-discovery/run.mjs --level normal --scenario discovery
node plugin/evals/exploration-discovery/run.mjs --level normal --scenario core
```

The verify command runs the fixture oracle without a model. The full run uses hosted models. It writes the Git fixture bundle, oracle, native usage, final reports, and Checkmate journal under `plugin/evals/results/`. Git ignores these files. The runner stops the previews when the arms finish.

## Score

Review all tester reports against the deterministic oracle. Use the same standard for both. Credit a finding when it describes the expected and actual behavior and an independent replay confirms it. This includes an actionable finding from source inspection. Mark a finding the tester tested against the running app when the trace shows the behavior. Group repeated symptoms from the same seeded case under its ID. Score the final Checkmate journal separately to measure which discoveries made it into the product record.

In the result directory, write `adjudication.json`. For smoke, use the lists `bare`, `smoke`, and `smokeJournal`. For normal, use `bare-a1`, `bare-a2`, `normal-a1`, `normal-a2`, and `normalJournal`. Each entry gives `outcome`, `artifact`, and `evidence`. Use `matched`, `false`, or `additional` as the outcome. A matched entry also gives the oracle `id`. The artifact names a file in the result directory, and the evidence names the reported case and replay. Set `observedInArm` to true when the tester trace confirms the behavior. Use `origin: "correct"` or `origin: "wrong"` to record whether the report correctly attributes a matched behavior to the base or the PR. Omit that field when the report leaves the origin open. The team score counts each seeded defect once. It uses the longer bare run for team wall time and sums reported cost across both testers. Count confirmed unseeded issues separately.

```sh
node plugin/evals/exploration-discovery/score.mjs plugin/evals/results/exploration-discovery-RESULT
```

Each comparison gives one result for each team on this fixture. Repeat the comparisons on fresh workspaces to measure variation.
