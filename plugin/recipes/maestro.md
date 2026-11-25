# Mobile recipe

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Use this recipe when the plan lists the `maestro` tool. Maestro drives a mobile app on an Android emulator or device, or on an iOS simulator.
For command details, run `maestro --help` or `maestro <command> --help`.

The instance of the target names the app and the device, for example the entries `app` (`com.example.shop`) and `device` (`emulator-5554`). Checkmate does not start, boot, or select a device. The factory or the person does that.

- Use only the device of the instance. Give `--device <device>` before the command on every `maestro` command.
- If the instance names no device, stop. Report the missing device as a blocker. Do not select a booted device yourself.
- Do not run `start-device`, `studio`, `record`, `login`, `cloud`, or a `--shard-*` option. Do not give `--driver-host-port`.

Put steps that need no screen read in between in one flow. Read the screen only for a decision or a check. On the iOS simulator, each `test` or `hierarchy` call restarts the driver. Startup took 12–15 seconds per call.

Put flows and output in your work folder. In execute, use `.checkmate/tmp/<runId>`. In this example, `work` is the absolute work folder and `device` is the device ID.

```sh
cat > "$work/checkout.yaml" <<'EOF'
appId: com.example.shop
---
- launchApp
- tapOn: "Cart"
- tapOn: "Checkout"
- takeScreenshot: T1-A1
EOF
XDG_STATE_HOME="$work/maestro-state" maestro --device "$device" test "$work/checkout.yaml" \
  --test-output-dir="$work/maestro" --debug-output="$work/maestro"
XDG_STATE_HOME="$work/maestro-state" maestro --device "$device" hierarchy --compact
```

- Start each flow with `appId: <app>` and `---`. Use the app ID of the instance.
- Use text or an `id` from the latest hierarchy for each screen. Never invent a selector.
- On iOS, tap a switch with `point:` inside the bounds of the element with `checked` or `value`. A tap on its row label or `id` can leave it unchanged.
- If an action target is off screen, scroll. If it is missing, wait one second. Read the hierarchy again and retry once. If the action still fails, close the test as error with the hierarchy excerpt.
- After an action, if a value still looks unchanged, read the hierarchy once more before you record it.
- Keep assertions out of the flow. Record the value for Checkmate to compare. If the check asks about an element that is absent after the action, use `run check --absent` with the hierarchy excerpt.
- A failed connection to the device or a failed driver start is a tool failure, not a product defect.

Where the plan observes from:

- `screen`: read the current screen with `hierarchy --compact` (CSV) or a screenshot.
- `relaunch`: use `stopApp` and `launchApp` to read stored state. If the app opens at its root screen, navigate again before you read it.

Evidence:

- When the hierarchy shows the result, attach a short excerpt with `--evidence -:view_hierarchy`. Do not write a text file.
- When appearance is the evidence, use `takeScreenshot: <name>` in the flow. Attach `<out>/<timestamp>/<flow>/takeScreenshot/<name>.png` with `--evidence <path>:screenshot`.
- When motion is the evidence, use `startRecording: <name>` and `stopRecording` around the steps. Attach `<out>/<timestamp>/<flow>/startRecording/<name>.mp4` with `--evidence <path>`. On iOS the file is a QuickTime movie.

Output and state:

- Give `--test-output-dir` and `--debug-output` on every `test` command. They direct flow artifacts to `<out>`. Maestro 2.12.1 can still write logs to `~/.maestro/tests/<timestamp>/`, including on `hierarchy`. Set `XDG_STATE_HOME` to an absolute path in your work folder on each Maestro call to move the default test logs to `$XDG_STATE_HOME/maestro/tests/`.
- In setup, use `.checkmate/tmp/setup-<targetId>`. `target save` removes that directory with its contents.
- If you give `--format`, give `--output` with a path in your work folder. Without `--output`, Maestro writes `report.xml` in the workspace.
- Do not use `clearState`, `clearKeychain`, or a new install of the app unless a precondition of the test asks for it and the operations of the target permit it. They delete the data of the app.
- Give credentials from the authentication references as shell variables with the prefix `MAESTRO_`, for example `MAESTRO_SHOP_PASSWORD="$SHOP_PASSWORD"`. Use `${MAESTRO_SHOP_PASSWORD}` in the flow. Do not write their values in a flow, a note, or evidence. Do not use `-e` for a credential.
- Save only relevant observations and screenshots. Do not save screens that show credentials.
- Checkmate does not sanitize screenshots, recordings, or hierarchy text.
