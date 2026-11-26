# Mobile recipe: Maestro MCP server

> **Agent only:** This file contains repository or workflow instructions for coding agents.

Use this recipe when the plan lists the `maestro-mcp` tool. The Maestro MCP server drives a mobile app on an Android emulator or device, or on an iOS simulator. It keeps the device driver between calls, so a step takes about one second.

The instance of the target names the app and the device, for example the entries `app` (`com.example.shop`) and `device` (`emulator-5554`). Checkmate does not start, boot, or select a device. The factory or the person does that.

## The server

When Checkmate starts the tester, it attaches the server. Its tools are `mcp__maestro_mcp__inspect_screen`, `mcp__maestro_mcp__run`, and `mcp__maestro_mcp__take_screenshot`. The server works in your work folder.

- If you do not have these tools, the host did not attach the server. Do not start `maestro mcp` yourself. If the target also lists the `maestro` tool, use the Maestro CLI recipe instead. Otherwise, stop and report the missing server as a blocker.
- Do not use other tools of a Maestro server, for example `list_devices`, `cheat_sheet`, the cloud tools, or `open_maestro_viewer`.

## Rules

- Give `device_id` on every call. Use the `device` entry of the instance. The server has no default device. Checkmate refuses a call with another device.
- If the instance names no device, stop. Report the missing device as a blocker. Do not select a booted device yourself.
- Give `run` only `yaml`, an inline flow. Never give `files` or `dir`. Checkmate refuses them.
- A flow has the header `appId: <app>`, then a line `---`, then the commands. Maestro 2.12.1 refuses a flow without the header, although the tool description says that a bare command works.
- Start with a flow that has `- launchApp` for the app of the instance, then read the screen. A Home screen or another app on the screen means that the app is not started yet, not an error of the test.
- Run one short step, then read the screen with `inspect_screen`. `run` tells you only if the flow passed.
- `inspect_screen` gives short keys. In a selector, use `a11y` as `text:` and `rid` as `id:`. `txt` is `text:` too.
- Tap or type only by a text or an `id` that the latest `inspect_screen` shows. Never invent a text or an `id`.
- A switch: a tap on its label or on the `id` of its row does not change it. Tap `point: <x>,<y>` inside the bounds (`b`) of the element that has `checked` or `val`. Then read the screen again. If the value did not change, wait one second and read it again before you tap again.
- If the element is not on the screen, wait one second, read the screen again, and retry once. If it is below the visible area, use `scrollUntilVisible` once.
- If the element is still missing, close the test as error. Give the `inspect_screen` excerpt as evidence. Do not record a defect.
- A text or element that a check names is not on the screen after the action: record it with `run check --absent` and the excerpt as evidence. This is a result, not an error.
- Do not put the check of the assertion in the flow, for example `assertVisible`. Read the value and record it. The code compares it with the expected value.
- Do not use `clearState`, `clearKeychain`, `launchApp` with `clearState`, `runScript`, `evalScript`, `openLink` to another app, or a new install of the app.
- A failed connection to the device or a failed driver start is a tool failure, not a product defect.

For example:

```json
{ "device_id": "<device>", "yaml": "appId: com.example.shop\n---\n- launchApp\n- tapOn: \"Sign in\"\n" }
```

## Where the plan observes from

- `screen`: read what the device shows now, with `inspect_screen`. This does not show that a change was stored.
- `relaunch`: for relaunch, run a flow with `- stopApp` and then `- launchApp`, navigate again, and read the screen. This shows what the app stored. The app can open at its first screen again.

## Evidence

- `view_hierarchy`: send a short excerpt of `inspect_screen` with `--evidence -:view_hierarchy`. Do not write a text file.
- `screenshot`: put `- takeScreenshot: <name>` in a flow. It writes `<name>.png` in your work folder. Give that file with `--evidence <path>:screenshot`. Give the path relative to the workspace, for example `.checkmate/tmp/<runId>/<name>.png`. `take_screenshot` shows you the screen, but it writes no file, so it is not evidence.
- `recording`: put `- startRecording: <name>` and `- stopRecording` around the steps. Give the `<name>.mp4` file of your work folder with `--evidence <path>`, relative to the workspace. Its kind is `recording`. Record only when the check needs motion.

## Data and credentials

- Do not put a credential value in a flow or in a tool argument, for example in `env` of `run`. If a test needs a credential, close the test as error. Name the authentication reference as the reason.
- Save only relevant observations and screenshots. Do not save screens that show credentials.
- Checkmate does not sanitize screenshots, recordings, or screen text.
