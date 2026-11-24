---
name: setup
description: Set up a Checkmate web target, correct its operations, or replace an instance.
---

Read the workspace instructions. Use Checkmate tools from the current session.

1. Call `checkmate_list_targets` when the target is unclear. Use the only target if it matches the request.
2. Ask for the running URL when the person omitted it. For a remote target, confirm the environment and allowed operations. Give production an explicit list of operations. Record credential references, never secrets.
3. Call `checkmate_setup` with the URL and the values the person gave. For a correction, set `correct` to true and name the existing target and instance. In a narrower instance correction, use `checkmate_replace_instance` with the full corrected entry values. Keep the returned instance ID for new work.
4. Read the reachability and the assumptions in the result. If a data policy is missing, ask how the environment resets or isolates test data. Use the person's policy or reset command. Do not invent a policy, reset, or cleanup hook.
5. If a result refuses the action, read its reasons and next action. Correct values you can verify. Ask for a decision only when the person must supply it.

Report the target, instance, and readiness. Stop here for a setup-only request. For a custom target with named entry points or a factory startup contract, use the factory setup workflow.
