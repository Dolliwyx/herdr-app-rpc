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

The hidden runtime files do **not** trigger Herdr mod hot reloads:

- `.presence.json`: sanitized desired activity and heartbeat.
- `.status.json`: helper PID, connection/error state, and last acknowledged activity. `published` means Discord acknowledged `SET_ACTIVITY`, not that its profile UI was visually inspected.

No npm packages, bot token, user token, web server, or scheduled task are needed. The activity explicitly displays the name **Herdr**. The application ID still selects your Discord application, and the art keys must exist in that registration.

## Configuration

Copy `config.example.json` to the installed mod's `config.json`, then enter your Discord application ID. The local config and runtime state are ignored by Git.

```json
{
  "clientId": "YOUR_DISCORD_APPLICATION_ID",
  "enabled": true,
  "privatePatterns": ["client-*", "Personal"],
  "largeImageKey": "herdr",
  "showHarnessIcon": true
}
```

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

The mod starts automatically in that personal layout. The 1px host lets it start without adding a panel or changing shipped mods. Keep **one host per Herdr app home**; multiple windows writing the same snapshot are not supported. Switching layouts closes the host, clearing this helper's presence. Return to `main-rpc` to resume.

From WSL, the Windows CLI is available through `/mnt/c/Program Files/PowerShell/7/pwsh.exe`; the agent's native Linux PATH does not contain it. `~/.config/herdr-app` here is a symlink to the Windows app home.

To remove it, switch back to `main`, then remove the personal `main-rpc` layout and `mods/discord-rpc` folder. Do not delete Herdr's shipped `main` layout.

## Verify

```sh
npm test
```

Run the same tests with Windows Node before installation. Also run `herdr-app check` and inspect `herdr-app status` for errors. In the running app, check `.status.json` for an acknowledged activity; switch pane/workspace, change an agent's status, and verify the sanitized `.presence.json` follows. Test pause/resume and layout removal to verify clearing. A named-pipe connection alone is not an end-to-end presence test.
