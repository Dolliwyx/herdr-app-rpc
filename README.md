# Herdr Discord presence

Show your Herdr workspace, Git branch, and agent activity on Discord.

```text
Herdr
herdr-app-rpc · main
Pi · 1/4 agents active
```

Presence runs while an RPC pane is open in Herdr. You can collapse the pane to zero width and keep using your other tabs and layouts. No Windows startup task, Discord token, or npm packages are needed.

## Install and start sharing

You need Windows, Node.js 20 or later, PowerShell 7 (`pwsh`), a running Herdr app, and desktop Discord with activity sharing enabled. Run the helper as the same Windows desktop user as Discord. macOS and Linux are not supported yet.

Workspace and branch names are public on Discord. If you need to hide them, [set privacy patterns](#hide-private-workspaces) before creating the RPC pane.

1. From the repository root in Windows PowerShell, install the mod:

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/install-windows.ps1
   ```

   The installer preserves your existing configuration. It does not create a pane or change Windows startup settings.

2. Check the installed mod:

   ```powershell
   herdr-app check "$HOME/.config/herdr-app/mods/discord-rpc"
   ```

3. Create an RPC pane beside the focused pane:

   ```powershell
   herdr-app do pane.split '{"direction":"right","mod":"discord-rpc","props":{"presenceHost":true}}'
   ```

   Keep only one RPC host pane per Herdr app home, including across windows. The command leaves your existing terminals in place.

4. Once the RPC pane has loaded, click **Collapse to 0px** to reclaim the space.

5. Open your Discord profile and check the activity.

If you use a custom Herdr app home, pass `-AppHome <path>` to the installer or set `HERDR_APP_HOME`. Use the same app home for the Herdr commands.

### Start presence after reopening Herdr

Show the tab that contains the RPC pane once after each Herdr launch. An inactive restored tab does not start presence until you visit it. Keep the pane in your startup-active tab to avoid this extra step.

After the pane loads, presence keeps updating across tab and layout changes. Keep the pane open while sharing. Use **Collapse to 0px**, not `layout.hide` or `hidden: true`. A hidden pane cannot initialize until you show it again.

## Change your settings

Open the settings dialog:

```powershell
herdr-app do mod.open --name discord-rpc
```

To add a keyboard shortcut, merge the entry from [`keys.json`](keys.json) into the `global` section of your Herdr app home's `keys.json`. Preserve your existing bindings. The bundled shortcut is **Ctrl+Alt+D**. Choose another binding if it is already assigned or conflicts with AltGr. Herdr reloads bindings without a restart.

Use **Save** to apply your changes or **Cancel** to discard them. Turning sharing off pauses presence immediately, even if you later cancel. To resume sharing, turn it on and save.

If another editor changes the configuration while the dialog is open, reload before saving. Reload discards your draft. If the file contains invalid configuration, fix the file before editing in the dialog.

Opening or closing settings does not start or stop presence. If you removed the host pane, click **Create RPC pane** to restore it at zero width. If the pane already exists, click **Go to RPC pane** to select it.

### Hide private workspaces

In settings, add workspace-name patterns to `privatePatterns`, then save. For example, use `client-*` to hide names that start with `client-`, or `Personal` to hide that workspace.

Patterns match the whole name, ignore case, and support `*` for any number of characters and `?` for one character. A match replaces the workspace name with `Private workspace` and removes the branch. The same protection applies when a borrowed terminal belongs to a private workspace.

Agent counts and harness names remain visible. The mod does not publish terminal titles, prompts, commands, raw directory paths, or machine names.

Do not put sensitive names directly into templates. Privacy patterns filter workspace and branch values, not text you type yourself.

### Customize the activity text

Edit **Details** and **State** in settings. Focus a field, then click a variable button to insert a value at the cursor.

Use `{workspace}` for the selected workspace and `{branch}` for the focused terminal's Git branch. Non-Git terminals and private workspaces omit the branch.

Use `{harness}` for the focused agent's harness, such as Pi or Codex. When a shell or mod has focus, the value lists the workspace's top-level harnesses, such as `Pi + Codex`.

Use `{agents.running}` and `{agents.total}` for agent counts across all Herdr spaces, including connected machines. Only live top-level reporting agents count. Working agents count as active. Blocked, done, and idle agents count toward the total. Sub-agents and ordinary shells do not count.

For singular and plural text, put both forms after a count variable:

```text
Working with {agents.running} {agents.running:person:people}
```

This renders as `Working with 1 person` or `Working with 0 people`. Both forms need nonblank text and cannot contain colons or braces.

Leave a template blank to omit that line. Empty variables also remove adjacent separators, so a missing branch does not leave a trailing ` · `. Keep templates within 512 characters. Discord text is limited to 128 Unicode codepoints after rendering. Use **Reset text** to restore the defaults.

To rotate State text, enable **Shuffle State templates** and use **Add template** for alternatives. Set an interval from 1 to 1440 whole minutes. The default is 3 minutes. Details does not rotate. Turning shuffle off restores the main State template and keeps your alternatives.

Choose **App name**, **State**, or **Details** for Discord's member-list text. An empty selected line falls back to `Herdr`.

### Change artwork or use your own Discord application

Keep the default `clientId` to use the shared Herdr Discord application. The ID is public, not a token.

If you use your own application, set its ID and upload artwork that matches your configured image keys. Omit `largeImageKey` for text-only presence. Supported harness icon keys include `pi`, `claude`, `codex`, `gemini`, `opencode`, `cursor`, and `copilot`.

For file-based configuration, edit `<appHome>/mods/discord-rpc/config.json`. See [`config.example.json`](mods/discord-rpc/config.example.json) for the defaults. The installer creates this file only when it is missing.

## Check a missing or stale activity

1. Confirm that desktop Discord is running and activity sharing is enabled.
2. Show the RPC pane's tab and check that sharing is on in settings.
3. Run `herdr-app status` to check for mod errors.
4. Inspect `<appHome>/data/discord-rpc/.status.json` for the helper's connection state, errors, and last acknowledged activity.
5. Compare `<appHome>/data/discord-rpc/.presence.json` with the activity you expect.
6. Check your Discord profile. The settings preview shows your draft, not proof of publication. A `published` status means Discord acknowledged the activity, not that the profile UI has been checked.

If another presence integration uses the same Discord application, pause it to prevent competing updates. The installer does not stop other integrations. The helper reconnects when Discord restarts.

To check cleanup, close the RPC host pane. Presence normally clears immediately. If cleanup cannot finish, the helper clears and exits after its last heartbeat expires, about 45 seconds plus any in-flight clear timeout.

## Upgrade an existing installation

1. Close the old RPC host pane.
2. Wait for the helper to clear and exit. Allow at least 45 seconds after the last heartbeat, plus any in-flight clear timeout.
3. Rerun the installer.
4. Create a new RPC host pane with the install command above.

Your configuration stays intact. Opening settings alone does not reload a running helper's code.

If you used the earlier standalone service, verify that its `Herdr Discord RPC` Scheduler task belongs to that installation. Stop and remove that task, then confirm that its service process has exited before creating a host pane. Leave unrelated tasks and processes alone. The installer does not migrate or remove them.

## Remove the mod

1. Close the RPC host pane and wait for the helper to clear and exit.
2. Delete `<appHome>/mods/discord-rpc/` and `<appHome>/data/discord-rpc/`.
3. Remove the optional shortcut or launcher if you added one.

Leave Herdr's shipped layouts and your other terminal panes unchanged.

## Run the tests

From the repository root, run:

```sh
npm test
```

For Windows changes, run the tests with Windows Node.js too. Check the installed mod with `herdr-app check`, then test workspace changes, agent counts, privacy, pause, and resume in Herdr. Switch tabs and layouts to confirm that updates continue. Inspect Discord separately to confirm the visible result.

See [RECIPE.md](RECIPE.md) for implementation details and [BACKLOG.md](BACKLOG.md) for planned work.
