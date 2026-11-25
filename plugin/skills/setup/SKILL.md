---
name: setup
description: Set up a Checkmate web target, correct its operations, or replace an instance.
---

Read the workspace instructions. Use Checkmate tools from the current session.

1. Call `checkmate_list_targets` when the target is unclear. Use the only target if it matches the request.
2. Ask for the running URL when the person omitted it. For an application that is not a web application, ask for the entries that its tool needs, for example the app ID and the device ID. The refusal of `checkmate_setup` names the entries that are missing. For a remote target, confirm the environment and allowed operations. Give production an explicit list of operations. Record credential references, never secrets. Use a specific read operation, for example `read_quotes`, when the person permits read-only tests. When the app stores no data, set `data` to `environment` and record the policy the person gave.
3. Call `checkmate_setup` with `url` for a web application, or with `entries` (name and value) for another application, and the values the person gave. To record only the data policy of a target that is set up, give `targetId` with `reset`, or with `data` and `policy`, and no URL. For a correction, set `correct` to true and name the existing target and instance. In a narrower instance correction, use `checkmate_replace_instance` with the full corrected entry values. Keep the returned instance ID for new work.
4. Use the reachability in the result. Do not probe the target yourself. Read and report the assumptions. If a data policy is missing, ask how the environment resets or isolates test data. Use the person's policy or reset command. Do not invent a policy, reset, or cleanup hook.
5. If a result refuses the action, read its reasons and next action. Correct values you can verify. Ask for a decision only when the person must supply it.

Report the target, instance, and readiness. Stop here for a setup-only request. For a custom target with named entry points or a factory startup contract, use the factory setup workflow.
