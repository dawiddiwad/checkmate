---
name: pull-request
description: Write the title and description of a Checkmate pull request. Use for every pull request, and when you update the description of one.
metadata:
  credits:
    - skill: pr
      author: Matt Pocock
      url: https://github.com/mattpocock/skills/tree/main/skills/engineering/pr
      license: MIT
    - skill: show-me
      author: Dex Horthy
      organisation: HumanLayer
      url: https://github.com/humanlayer/humanlayer/blob/main/apps/riptide-humanlayer-claude-plugin/skills/show-me/SKILL.md
      license: Apache-2.0
---

> **Agent only:** This file contains repository or workflow instructions for coding agents.

## Rules

- Make the description brief and easy to read. A reviewer reads it in two minutes.
- Show what changed as a `diff` sketch when you can. A diff is the preferred visual.
- Use one or two visuals. Do not add a diagram that repeats the text.
- Keep noisy details in the commits: file lists, refactors, step-by-step history, and test names. The description does not repeat the commit log.
- Add screenshots for a UI change: before and after.
- Write short sentences. Use Checkmate words: target, instance, plan, revision, run, test, assertion, finding, gap, oracle, recipe, tester. Skip the preamble.
- Open one pull request for each finished piece of work. Open one pull request to `main` for each release.

## Body

Use the three sections of `.github/pull_request_template.md`, in that order.

### Summary

Give the change in one sentence, then the smallest visual that makes the point. Put each visual next to the sentence that it supports. Keep only the calls, files, states, and boundaries that the reviewer needs.

Use `diff` when the shape already exists and the point is what changes. Match the diff to the topic:

```diff
 record_check
   compare the observation with the expected value
+  compare the observation with the attached text
+  disagree → inconclusive, with the reason
   store the verdict
```

```diff
 plugin/skills/
-└── test/SKILL.md                     # edited by hand
+└── test/SKILL.md                     # generated, do not edit
 scripts/templates/
+└── plugin/skills/test/SKILL.md       # edit here
```

Use another form only when a diff does not fit:

- Pseudocode for logic or a rule.
- A call tree for runtime control flow.
- A component tree for UI structure, with the state and module boundaries that matter.
- A shallow file tree for a change in file responsibility.
- Mermaid for interaction between processes, for example host, CLI, and testers.
- The whole block when most of it is new, or when the order or ownership is the point.

### Evidence

Show before and after for each claim. A screenshot is the best evidence for a visual change. A command result or a test that failed and now passes is next. Give the build or commit, the host, and the model when a live run is the evidence. Say which checks you did not run.

### Merge Danger

**Door:** `one-way` when a merge cannot be undone with a revert, for example a stored shape that old versions cannot read. Otherwise `two-way`.

**Blast Radius:** one word, for example `docs`, `assertions`, `workspace`, or `wide`. Then list the known risks and open problems, one line each.

## Size

| Pull request                | Description, without screenshots |
| --------------------------- | -------------------------------- |
| One fix or one small change | 100–250 words (see #95)          |
| One feature                 | up to 400 words                  |
| A release to `main`         | up to 600 words (see #93)        |

If the description is longer, move details to the commits.

## Repository facts

- Write the body to a file and pass it with `gh pr create --body-file <file>` or `gh pr edit --body-file <file>`. Do not pass a long body in a shell argument.
- Upload a screenshot in the GitHub web editor of the description or of a comment, and copy its `https://github.com/user-attachments/assets/...` link. `gh` cannot upload images. Put more than two screenshots in a `<details>` table. `node scripts/ui-screenshots.ts <folder>` captures the review UI with sample records.
- A merge to `main` publishes an npm and GitHub release, unless the pull request has the `skip-release` label (`release-source` in `.github/workflows/ci.yml`). Add the label only when the merge does not change Checkmate: for example developer guidance, CI, or repository docs that do not ship. Say so in Merge Danger.
- End the description with the attribution line that your host gives.

## Before you post

- [ ] The Summary has a diff sketch, or a reason for another visual.
- [ ] Each Evidence item has a before and an after, and names unrun checks.
- [ ] Door and Blast Radius are filled.
- [ ] The length is in the size table.
- [ ] A UI change has screenshots.
- [ ] No file lists or commit history in the description.
- [ ] The `skip-release` label is set only when Checkmate does not change.

Credits: adapted from `pr` by Matt Pocock (MIT, © 2026 Matt Pocock) and `show-me` by Dex Horthy (Apache-2.0, © 2025-2026 QueryTale, Inc. d/b/a HumanLayer). Changed: merged into one skill, rewritten for Checkmate, and the examples replaced.
