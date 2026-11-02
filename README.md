# Herdr Discord presence

A tab-owned Herdr mod plus a dependency-free Windows Discord helper. Show the RPC pane once to start presence, then optionally resize it to zero width so it takes no visible space. The loaded pane stays alive across tab and layout switches. No Windows login task or startup launcher is used.

```text
Herdr
herdr-app-rpc · main
Pi · 1/4 agents active
```

- Counts **all Herdr spaces**, including connected machines, but **only live top-level reporting agents**. Sub-agents and ordinary shells do not count. Active means `working`; blocked, done, and idle still count toward total.
- Workspace follows the selected Herdr space. Branch follows the focused or borrowed terminal through Herdr’s native API. Missing branch metadata uses a Git lookup on that terminal’s machine, cached for ten seconds per unchanged context. Non-Git terminals omit the branch.
- Harness follows the focused reporting agent. With a shell/mod focused, it uses the workspace's top-level harnesses (for example, `Pi + Codex`). No model detection or terminal scraping.
- Matching `privatePatterns` replace the workspace with `Private workspace` and omit the branch, including a borrowed terminal’s private owner space. Counts and harness remain visible. Patterns are case-insensitive whole-name globs supporting `*` and `?`.
- **Startup limitation:** an inactive restored mod pane does not initialize until its tab is shown. Keep the host pane in your startup-active tab, or visit it once after opening Herdr. Once loaded, it keeps running when its tab is inactive or another layout is selected.
- Publishes no terminal titles, prompts, command lines, raw working-directory paths, or machine names. Workspace and branch names are public on Discord.

## Files

`mods/discord-rpc/main.js` starts a presence host only when opened with `props: {"presenceHost":true}`. The host reads native Herdr spaces, terminals, agents, panes and focus, maps them through `presence.js`, and writes sanitized desired activity. A one-second timer coalesces changes and refreshes the heartbeat at least every ten seconds, including while the host is zero-width or its tab is inactive. Settings overlays, optional launchers and legacy no-props layout blocks do not host presence.

`bridge.mjs` maintains Discord’s named-pipe connection and sends `SET_ACTIVITY`. It reconnects after Discord restarts and limits non-null updates to one every 15 seconds. Pausing clears without waiting for that throttle. Closing the host pane attempts to clear immediately. Closing Herdr ends the host; if its final clear cannot finish, the helper clears and exits after the last heartbeat expires (45 seconds, plus an in-flight clear timeout).

All mutable runtime files, including atomic temporary files, live in `<appHome>/data/discord-rpc/`, outside the watched `mods/` tree:

- `.presence.json`: sanitized desired activity and heartbeat.
- `.status.json`: helper PID, connection/error state, and last acknowledged activity. `published` means Discord acknowledged `SET_ACTIVITY`, not that its profile UI was visually inspected.

Source and local `config.json` remain in `<appHome>/mods/discord-rpc/`. No npm packages, bot token, user token, web server, OS login service or Scheduler task are needed. The activity explicitly displays **Herdr**; the application ID selects the Discord application, whose artwork keys must match the configuration.

## Configuration

The installer creates the installed mod’s `config.json` from `config.example.json` only when absent; existing configuration is preserved. It uses the shared Herdr Discord application. Local config and runtime state are ignored by Git.

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

Press **Ctrl+Alt+D** after merging the bundled `keys.json` entry into your Herdr app home's `keys.json` under `global`. Preserve existing bindings; choose another key if it is already assigned or conflicts with AltGr typing on your keyboard. Herdr reloads bindings live. The shortcut opens settings in any layout; it does not start presence.

If your layout includes the optional launcher, click its **Discord logo** (tooltip: “Discord presence”). You can always open the native configuration dialog with:

```powershell
herdr-app do mod.open --name discord-rpc
```

Use **Create RPC pane** in settings to restore a removed host as a zero-width pane beside the currently focused pane. If an RPC pane already exists, **Go to RPC pane** selects it instead of creating a duplicate. This action does not save or discard your settings draft.

The dialog is separate from the host pane: opening or closing settings does not start another helper or clear presence. **Save** applies your draft together; **Cancel** discards it. Turning sharing **off pauses immediately**, even if you later cancel. Turning it back on requires Save. Reload discards draft edits and rereads the file. Saves are atomic and refuse to overwrite a configuration changed elsewhere; Reload after a conflict. Missing configuration starts with the shared application defaults; malformed configuration must be fixed in the file before editing.

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

The installer preserves this mod’s existing `config.json`; it does not import or stop other presence integrations. Two integrations using the same Discord application may compete; pause the old one if it overwrites this presence.

## Install

Requires Windows Node.js 20+, PowerShell 7 (`pwsh`), a running Herdr app, and desktop Discord with activity sharing enabled. The helper runs as the normal Windows desktop user in Discord’s session. macOS/Linux support is deferred; see [BACKLOG.md](BACKLOG.md).

From the repository root in Windows PowerShell:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/install-windows.ps1
herdr-app check "$HOME/.config/herdr-app/mods/discord-rpc"
herdr-app do pane.split '{"direction":"right","mod":"discord-rpc","props":{"presenceHost":true}}'
herdr-app status
```

The installer only copies mod/helper files, preserves existing `config.json`, and creates defaults if missing. It does not create a pane, login task, or startup launcher. Use `-AppHome <path>` to target a nondefault app home (it also respects `HERDR_APP_HOME`); target the same app home when running Herdr commands.

The `pane.split` command adds a host beside the focused pane in the current tab without replacing its terminals. **Create only one host pane per app home.** Multiple host panes/windows writing the same snapshot are unsupported. No layout definitions need editing. Settings and its optional global shortcut/launcher are separate from the host.

For an invisible host, resize the new RPC pane to zero width after it has initialized. Use its pane ID, not the original terminal’s ID:

```powershell
herdr-app do layout.resize '{"id":"<RPC_PANE_ID>","px":0}'
```

Keep the pane present and **do not use `layout.hide` or set `hidden: true`**. Zero width still leaves it in Herdr’s visible-pane scan, so it can initialize when its tab is selected after a restart; a hidden pane is excluded from that scan. Resize it wider temporarily if you want its host controls, or use the settings shortcut.

The host belongs to its tab, so it stays alive across tab and layout switches after initialization. Do not close its pane while sharing. On the next Herdr start, it initializes only if its tab is shown; an inactive saved pane is not an app-wide startup hook.

### Upgrade or migrate

Rerun the installer without replacing local configuration. A running Node helper retains its loaded JavaScript: close the old host and let its heartbeat lease expire (45 seconds plus an in-flight clear timeout), install the files, then add the new host pane. Opening settings alone does not upgrade a running helper.

If migrating from the earlier standalone service, stop and remove its **verified owned** `Herdr Discord RPC` Scheduler task before starting the pane host, and ensure its service process has exited. The file-copy installer deliberately does not inspect or modify Scheduler tasks or unrelated startup mechanisms. Do not leave the old collector running beside a pane host. Legacy no-props layout blocks remain inert and can be removed from personal layouts; do not modify shipped layouts.

### Remove

Close the RPC host pane, then let the helper clear and exit before removing the installed mod and runtime directory. Remove an optional shortcut/launcher only if you installed it. Do not remove Herdr’s shipped layouts or other terminal panes.

## Verify

```sh
npm test
```

Run tests with Windows Node as well. Check `herdr-app check` and `herdr-app status` for mod errors. Inspect `<appHome>/data/discord-rpc/.status.json` for acknowledged activity and `.presence.json` for sanitized desired activity. Verify workspace/pane changes, agent-status counts, privacy, pause/resume, and that switching tabs/layouts leaves updates running. Close the host pane to verify clearing. On reopening Herdr, show the host’s saved tab to start it; do not claim automatic startup from an inactive pane. A named-pipe connection or settings preview alone is not an end-to-end publication check; inspect Discord separately before claiming its profile UI was verified.
