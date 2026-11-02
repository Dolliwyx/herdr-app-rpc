# Herdr Discord presence

A headless Herdr mod plus a dependency-free Node helper running on the same Windows desktop as Discord.

```text
Herdr
herdr-app-rpc · main
Pi · 1/4 agents active
```

- Counts **all Herdr spaces**, including connected machines, but **only live top-level reporting agents**. Sub-agents and ordinary shells do not count. Active means `working`; blocked, done, and idle still count toward total.
- Workspace follows the selected Herdr space. Branch follows the focused terminal, not the space's first terminal. When Herdr has no branch metadata (including a repository with no commits), a cached Git lookup runs on that terminal's machine, at most every ten seconds per unchanged context. Non-Git terminals omit the branch.
- Harness follows the focused reporting agent. With a shell/mod focused, it uses the workspace's top-level harnesses (for example, `Pi + Codex`). No model detection or terminal scraping.
- Matching `privatePatterns` replace the workspace with `Private workspace` and omit the branch. This also covers a terminal borrowed from a private space. Counts and harness remain visible. Patterns are case-insensitive whole-name globs supporting `*` and `?`.
- Publishes no terminal titles, prompts, command lines, raw working-directory paths, or machine names. Workspace and branch names are public on Discord.

## Files

`mods/discord-rpc/main.js` reads Herdr's live API, coalesces changes, and writes a sanitized `.presence.json` snapshot. Every ten seconds it refreshes a heartbeat and ensures the local helper is running. `presence.js` contains the tested data mapping and privacy rules.

`bridge.mjs` maintains the Discord named-pipe connection, handshakes using your application ID, and sends `SET_ACTIVITY`. It reconnects after Discord restarts and limits non-null updates to one every 15 seconds. Pausing clears immediately. If Herdr stops refreshing the heartbeat for 45 seconds, it clears presence and exits.

All mutable runtime files (including atomic temporary files) live in `<appHome>/data/discord-rpc/`, outside the watched `mods/` tree. Hidden files inside a mod can still trigger hot reloads through native parent-directory notifications. Mod source and `config.json` remain in `<appHome>/mods/discord-rpc/`:

- `.presence.json`: sanitized desired activity and heartbeat.
- `.status.json`: helper PID, connection/error state, and last acknowledged activity. `published` means Discord acknowledged `SET_ACTIVITY`, not that its profile UI was visually inspected.

When upgrading from mod-local runtime files, keep the same mod directory: its singleton identity prevents a competing helper. Once the new host stops refreshing the old snapshot, the old helper clears and exits within 45 seconds (plus an in-flight clear timeout). The new host retries startup every ten seconds. Old `.presence.json` and `.status.json` files under `mods/discord-rpc/` are inert after that; do not use them to check the new helper. An already-failed Herdr runtime may need a window-only restart to load the fix.

No npm packages, bot token, user token, web server, or scheduled task are needed. The activity explicitly displays the name **Herdr**. The application ID still selects your Discord application, and the art keys must exist in that registration.

## Configuration

Copy `config.example.json` to the installed mod's `config.json`. It already uses the shared Herdr Discord application. The local config and runtime state are ignored by Git.

> **Application ID:** Leave `clientId` unchanged unless you know what you're doing and want to use your own Discord application. If you change it, that application's image assets must match this configuration. The application ID is public—not a secret or a token.

```json
{
  "clientId": "1529832902387302510",
  "enabled": true,
  "privatePatterns": ["client-*", "Personal"],
  "largeImageKey": "herdr",
  "showHarnessIcon": true,
  "detailsTemplate": "{workspace} · {branch}",
  "stateTemplate": "{harness} · {agents.running}/{agents.total} agents active",
  "statusDisplayType": "name"
}
```

### Settings screen

Click the **Discord logo** (tooltip: “Discord presence”) at the bottom-right of the custom layout’s status bar. Alternatively, open the native configuration dialog with:

```powershell
herdr-app do mod.open --name discord-rpc
```

The dialog is separate from the headless layout host: opening or closing settings does not start another helper or clear presence. **Save** applies your draft together; **Cancel** discards it. Turning sharing **off pauses immediately**, even if you later cancel. Turning it back on requires Save. Reload discards draft edits and rereads the file. Saves are atomic and refuse to overwrite a configuration changed elsewhere; Reload after a conflict. Missing configuration starts with the shared application defaults; malformed configuration must be fixed in the file before editing.

The preview shows draft text for the current workspace, including privacy changes, independently of whether sharing is paused. Connection status and the last Discord acknowledgment are labeled separately. Artwork uses the local Herdr image as a reference for the shared application's default `herdr` key; asset-key labels identify the configured images, not a fetched Discord rendering.

### Presence templates

Both `detailsTemplate` and `stateTemplate` accept ordinary text and these variables. Focus either field, then use a variable button to insert at the cursor or replace the selection.

| Variable | Value |
| --- | --- |
| `{workspace}` | Selected workspace name, or `Private workspace` |
| `{branch}` | Focused terminal's branch; empty for non-Git or private workspaces |
| `{harness}` | Focused agent's harness, or the workspace's top-level harnesses |
| `{agents.running}` | Working live top-level reporting agents across all spaces |
| `{agents.total}` | All live top-level reporting agents across all spaces |

Privacy is applied **before** substitution, in either field. Raw paths and other terminal metadata are not available as variables. Empty variables remove adjacent template separators (such as ` · ` or ` | `), never punctuation inside variable values. Literal text is left as you entered it: do not type sensitive names directly into templates. Unknown variables and malformed braces are rejected. Templates allow up to 512 characters; rendered lines are sanitized and truncated to 128 Unicode codepoints. Blank templates omit that optional field; a one-character result is prefixed with `In ` for Discord's minimum text length. Omitted template settings retain the original format; Reset text restores it.

`statusDisplayType` selects the text shown in Discord's member list: `name` (Herdr, the default), `state`, or `details`. The expanded activity retains both text lines. If the selected template renders empty, the member-list display falls back to the app name.

Set `enabled` to `false` to pause. Invalid configuration fails closed. Omit `largeImageKey` for text-only presence. Uploaded small-image keys supported by this version include `pi`, `claude`, `codex`, `gemini`, `opencode`, `cursor`, and `copilot`.

On this machine the installation takes `clientId`, `privatePatterns`, and image preferences from `~/.config/herdr-presence/config.json`. It does not modify that file or stop its existing integration. Two integrations using the same Discord application may compete; pause the old one if it overwrites this presence.

## Install

Requires Windows Node.js 20+, desktop Discord with activity sharing enabled, and a running Herdr app.

1. Copy `mods/discord-rpc` into Herdr's `mods/` directory. Do not overwrite an unrelated mod with the same name. Create its local `config.json` as above.
2. In **Windows PowerShell**, check the mod:

   ```powershell
   herdr-app check "$HOME/.config/herdr-app/mods/discord-rpc"
   ```

3. Clone the current shipped layout rather than editing it:

   ```powershell
   herdr-app do layout.clone '{"name":"main","as":"main-rpc"}'
   ```

4. In `layouts/main-rpc.json`, append this headless host to the `work` column's `children`:

   ```json
   {"id":"discord-rpc","type":"block","size":{"px":1},"content":{"mod":"discord-rpc"}}
   ```

5. For a clickable launcher, replace the existing `status` block with a row containing that same status mod and a launcher block:

   ```json
   {
     "id": "status-row", "type": "row", "resizable": false, "size": {"px": 28},
     "children": [
       {"id": "status", "type": "block", "size": {"weight": 1}, "content": {"mod": "workspace-status"}},
       {"id": "discord-settings-button", "type": "block", "size": {"px": 40}, "content": {"mod": "discord-rpc", "props": {"launcher": true}}}
     ]
   }
   ```

The mod starts automatically in that personal layout. The 1px host runs presence; the separate launcher only opens settings and never starts or clears presence. No shipped mods are changed. Keep **one host per Herdr app home**; multiple windows writing the same snapshot are not supported. Switching layouts closes the host, clearing this helper's presence. Return to `main-rpc` to resume.

From WSL, the Windows CLI is available through `/mnt/c/Program Files/PowerShell/7/pwsh.exe`; the agent's native Linux PATH does not contain it. `~/.config/herdr-app` here is a symlink to the Windows app home.

When upgrading an already-running installation, the helper process retains its loaded JavaScript. Switch to `main` first and let the heartbeat lease expire (45 seconds, plus an in-flight clear timeout) so the old helper exits; copy the updated mod files without overwriting your local `config.json`, then return to `main-rpc`. Merely opening the new settings dialog does not upgrade the old helper.

To remove it, switch back to `main`, then remove the personal `main-rpc` layout and `mods/discord-rpc` folder. Do not delete Herdr's shipped `main` layout.

## Verify

```sh
npm test
```

Run the same tests with Windows Node before installation. Also run `herdr-app check` and inspect `herdr-app status` for errors. In the running app, check `<appHome>/data/discord-rpc/.status.json` for an acknowledged activity; switch pane/workspace, change an agent's status, and verify the sanitized `<appHome>/data/discord-rpc/.presence.json` follows. Test pause/resume and layout removal to verify clearing. A named-pipe connection alone is not an end-to-end presence test.
