---
name: setup
description: Set up a Checkmate web target, correct its operations, or replace an instance.
---

Read the workspace instructions. Use Checkmate tools from the current session.

1. Call `checkmate_list_targets` when the target is unclear. Use the only target if it matches the request.
2. Ask for the application address or the entries its tool needs. For a remote target, confirm the environment and the operations the person permits. Record credential references.
3. Call `checkmate_setup` with the information the person gave. Use `checkmate_replace_instance` for an instance correction. Use the instance ID that the tool returns.
4. Use the reachability in the result. Do not probe the target yourself. Read and report the assumptions. If a data policy is missing, ask how the environment resets or isolates test data. Use the person's policy or reset command. Do not invent a policy, reset, or cleanup hook.
5. If a result refuses the action, read its reasons and next action. Correct values you can verify. Ask for a decision only when the person must supply it.

Report the target, instance, and readiness. Stop here for a setup-only request. For a custom target with named entry points or a factory startup contract, use the factory setup workflow.
