# Dev Guide

## [HumanLayer](https://humanlayer.dev) gives each task its own agentic workspace

It supports CRISPY, RPI, PRD, and freeform workflows where humans and agents follow a structured, interactive, and guided process.

When you start a task, the [workspace config](../.humanlayer/workspace.json):

1. Creates a separate git worktree and branch for the task.
2. Runs `npm install`.
3. Copies local environment and agent settings into the worktree, without committing them.

This lets you work on several tasks without their edits colliding. Change the paths,
setup command, or copied files in the config above.

<summary>Preview</summary>
<img src="img/hl-task.png" alt="HumanLayer task workspace" width="100%"/>
<img src="img/hl-review.png" alt="HumanLayer review" width="100%"/>

## Wiki

- [Architecture](../.agents/wiki/architecture.md)
- [Standards](../.agents/wiki/coding-standards.md)
- [Procedures](../.agents/wiki/development-procedures.md)
