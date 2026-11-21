# Exploratory defect discovery

This calibration compares one bare Pi run with one Checkmate smoke exploration. Both use `openai-codex/gpt-6-luna` at medium effort. Smoke starts one tester. It includes a study turn, a test turn, and recording.

Harbor Rentals is a local equipment reservation app with a browser desk and HTTP API. Each agent gets a separate copy of the same Git repository. The active branch contains PR 27 and the full source. Each agent can inspect the base with `git show main:app.mjs` or the PR with `git diff main...HEAD`. Each arm has its own deployed base and PR previews. The previews serve the source from the corresponding Git commits. The fixture and answer key stay outside the agent workspaces.

The base has six existing defects. The PR preserves those defects and introduces six regressions. A deterministic oracle checks all 12 behaviors on the base, PR, and a fixed control. It also checks browser bulk rescheduling and the effect of an invalid batch. The agents get the same product contract, PR text, tool access, and wall-clock limit. Bare Pi gets a short request to explore and report findings. The Checkmate arm gets its usual smoke workflow and a four-minute test turn.

## Run

From the repository root, use Node.js 24, an authenticated Pi host, Chrome, and `playwright-cli`. The Pi host supplies credentials. For the oracle, set `BROWSER_EXECUTABLE` if Chrome is in a nonstandard location.

```sh
node scripts/build-cli.ts
node plugin/evals/exploration-discovery/run.mjs --verify
node plugin/evals/exploration-discovery/run.mjs
```

The verify command runs the fixture oracle without a model. The full run uses hosted models. It writes the Git fixture bundle, oracle, native usage, final reports, and Checkmate journal under `plugin/evals/results/`. Git ignores these files. The runner stops the previews when the arms finish.

## Score

Review the bare report and the smoke tester report against the deterministic oracle. Use the same standard for both. Credit a finding when it describes the expected and actual behavior and an independent replay confirms it. This includes an actionable finding from source inspection. Mark a finding the tester tested against the running app when the trace shows the behavior. Group repeated symptoms from the same seeded case under its ID. Score the final Checkmate journal separately to measure which discoveries made it into the product record.

In the result directory, write `adjudication.json` with three lists named `bare`, `smoke`, and `smokeJournal`. Each entry gives `outcome`, `artifact`, and `evidence`. Use `matched`, `false`, or `additional` as the outcome. A matched entry also gives the oracle `id`. The artifact names a file in the result directory, and the evidence names the reported case and replay. Set `observedInArm` to true when the tester trace confirms the behavior. Count confirmed unseeded issues separately. Repeat observations about one seeded defect receive one credit.

```sh
node plugin/evals/exploration-discovery/score.mjs plugin/evals/results/exploration-discovery-RESULT
```

One pair of runs checks whether the fixture is suitable for a larger evaluation. It gives no estimate of variation across attempts or applications.
