# Mobile recipe

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Use this recipe when the plan lists the `maestro` tool. Maestro drives a mobile app on an Android emulator or device, or on an iOS simulator.
For command details, run `maestro --help` or `maestro <command> --help`.

The instance of the target names the app and the device, for example the entries `app` (`com.example.shop`) and `device` (`emulator-5554`). Checkmate does not start, boot, or select a device. The factory or the person does that.

- Use only the device of the instance. Give `--device <device>` before the command on every `maestro` command.
- If the instance names no device, stop. Report the missing device as a blocker. Do not select a booted device yourself.
- Do not run `start-device`, `studio`, `record`, `login`, `cloud`, or a `--shard-*` option. Do not give `--driver-host-port`.

Maestro runs flow files. Drive the app one step at a time: write a short flow, run it, then read the screen. Put the flow and the output in your work folder. In execute, the work folder is `.checkmate/tmp/<runId>`:

```sh
cat > .checkmate/tmp/<runId>/step.yaml <<'EOF'
appId: com.example.shop
---
- launchApp
- tapOn: "Sign in"
- takeScreenshot: T1-A1
EOF
maestro --device <device> test .checkmate/tmp/<runId>/step.yaml \
  --test-output-dir=.checkmate/tmp/<runId>/maestro --debug-output=.checkmate/tmp/<runId>/maestro
maestro --device <device> hierarchy --compact
```

- Write a new flow for each step. A flow has the header `appId: <app>`, then `---`, then the commands.
- After each step, read the screen with `hierarchy --compact`. It prints the elements of the screen as CSV. Read the value from that output.
- Tap or type only by a text or an `id` that the latest hierarchy shows. Never invent a text or an `id`.
- If the element is not in the hierarchy, wait one second, read the hierarchy again, and retry once.
- If the element is still missing, close the test as error. Give the hierarchy excerpt as evidence. Do not record a defect.
- A text or element that a check names is not in the hierarchy after the action: record it with `run check --absent` and the hierarchy excerpt as evidence. This is a result, not an error.
- Do not put the check of the assertion in the flow, for example `assertVisible`. Read the value and record it. The code compares it with the expected value.
- A failed connection to the device or a failed driver start is a tool failure, not a product defect.

Where the plan observes from:

- `screen`: read what the device shows now, with `hierarchy --compact` or a screenshot. This does not show that a change was stored.
- `relaunch`: run a flow with `- stopApp` and then `- launchApp`, then read the screen. This shows what the app stored.

Evidence:

- `view_hierarchy`: send a short excerpt of the hierarchy with `--evidence -:view_hierarchy`. Do not write a text file.
- `screenshot`: `takeScreenshot: <name>` writes `<name>.png` in the output folder. Find it with `find .checkmate/tmp/<runId>/maestro -name '<name>.png'`, and give that path with `--evidence <path>:screenshot`.
- `recording`: put `- startRecording: <name>` and `- stopRecording` around the steps. Give the `.mp4` file with `--evidence <path>:recording`. Record only when the check needs motion.

Output and state:

- Give `--test-output-dir` and `--debug-output` on every `test` command. Without them, Maestro writes to a folder in your home directory.
- In setup, use `.checkmate/tmp/setup-<targetId>`. `target save` removes that directory with its contents.
- Do not give `--format` without `--output` in your work folder. Without `--output`, Maestro writes `report.xml` in the workspace.
- Do not use `clearState`, `clearKeychain`, or a new install of the app unless a precondition of the test asks for it and the operations of the target permit it. They delete the data of the app.
- Give credentials from the authentication references as shell variables with the prefix `MAESTRO_`, for example `MAESTRO_SHOP_PASSWORD="$SHOP_PASSWORD"`. Use `${MAESTRO_SHOP_PASSWORD}` in the flow. Do not write their values in a flow, a note, or evidence. Do not use `-e` for a credential.
- Save only relevant observations and screenshots. Do not save screens that show credentials.
- Checkmate does not sanitize screenshots, recordings, or hierarchy text.
