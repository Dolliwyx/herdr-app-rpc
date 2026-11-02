# Discord Presence

Share the selected Herdr workspace, its focused terminal’s branch, the agent harness, and app-wide agent counts as a Discord Playing activity named **Herdr**. A small Discord button opens native settings with a draft activity preview, editable presence text, privacy rules, and artwork preferences. The presence host itself is invisible. The screenshot shows a configured installation, not the default text.

![Herdr Discord presence](preview.png)

## What you see

- Optional launcher: an 18px monochrome Discord mark centered in a 40px-wide block alongside the existing 28px status bar. It inherits the current theme, with a hover background and a “Discord presence” tooltip.
- Settings: a 560px-wide, 760px-high native dialog, 18px padding, fixed title/status header and fixed Reload / Cancel / Save footer; the middle scrolls. The title is 16px semibold, body 13px, notes 12px with 18px line height. Section headings have 18px above and 8px below.
- Top: “Discord presence”, Close, connection/acknowledgment status, then “Share activity on Discord” and a warning that pausing is immediate.
- Preview: draft/current-workspace label, compact member-list text, then an expanded activity card with app name, Details and State. Default Herdr artwork is 48px square. Image-key labels and the last acknowledged text/time are separate from the draft.
- Presence text: App name / State / Details selection for Discord’s member list, two labeled single-line inputs, five variable-insertion buttons, and Reset text.
- Privacy: editable workspace-pattern rows with Remove, a new-pattern input with Add, and a count of current matching spaces. Appearance: artwork and harness-icon switches. Advanced reveals application ID and large-image asset key.
- Use the host’s UI font and theme colors, not fixed Discord colors: popover for the dialog, background for inputs/card, foreground/muted for text, input for borders, raised for secondary actions, solid/solid_foreground for Save, accent for selected switches and focus, blocked for errors. Buttons are 30px high, inputs 32px, both with 6px corners. Preview has 12px padding and 8px corners. Gaps are generally 6–8px. Switches are 36×22px with 14px knobs.

## How it behaves

- With a workspace selected, Discord shows Herdr, workspace plus focused branch, and harness plus working/total agents. No workspace means no activity. A non-Git terminal or focused mod omits the branch rather than borrowing another pane’s branch.
- Count live, top-level reporting agents across all connected spaces. Working increments both running and total; blocked, done and idle increment total only. Shells, finished terminals and sub-agents do not count. These statuses have no individual colored badge or animation in this mod; they affect the text counts. A focused reporting sub-agent may still supply the harness name.
- Harness follows the focused reporting agent, otherwise the selected workspace’s unique top-level harnesses joined with “ + ”. Recognize Pi, Claude Code, Codex, Gemini, OpenCode, Cursor and GitHub Copilot; retain other reported names without guessing a model.
- Workspace privacy matches whole names, case-insensitively, with star/question-mark wildcards. A private selected space or borrowed terminal owner becomes “Private workspace” with no branch in either text line. Harness and counts remain visible.
- Default Details is workspace, separator, branch; default State is harness, separator, running/total agents active. The five insertion controls target the cursor/selection in the last focused text field. Reset text restores these defaults. Empty variables remove adjacent template separators, not punctuation inside values. Blank templates omit that optional line. Empty selected member-list text falls back to Herdr.
- Changes preview immediately but publish only after Save. Cancel, Close and Escape discard unsaved edits. Turning sharing off is the exception: persist the last saved configuration with sharing disabled immediately, without publishing other draft edits. Cancel does not undo that pause. Turning sharing back on requires Save.
- Reload discards the draft and rereads configuration. Save validates, preserves unknown configuration fields, refuses concurrent external edits, and closes on success. Conflicts leave the draft visible with Reload guidance. Missing configuration opens with shared defaults; malformed configuration shows an error and Reload, not editable defaults.
- Opening/closing settings or using the launcher never creates or clears another presence host. Buttons have hover feedback, accessible names, keyboard focus, and native keyboard behavior. The body scrolls; nothing animates or drags within the mod. The bundled global Ctrl+Alt+D shortcut opens settings in any layout after its entry is merged into the person's keys.json.
- Presence updates coalesce; unchanged activity is not republished. Non-null Discord updates are throttled to one per 15 seconds; pausing clears without waiting for that throttle. Retry Discord after disconnects. Stop and clear when the host heartbeat expires after 45 seconds. Closing/removing the host attempts to clear immediately.

## Built from

Package one repository-root folder containing `mods/discord-rpc/`, `keys.json`, this `RECIPE.md`, and `preview.png`. Do not ship `layouts/`, personal `config.json`, or runtime state. Bundle `keys.json` with `{"global":{"ctrl-alt-d":"mod.open:discord-rpc"}}`; merge that entry into the person's existing keys without replacing unrelated bindings, and ask before overwriting a conflict. Ctrl+Alt can conflict with AltGr typing on some keyboards. Build against the installed Herdr `herdr.d.ts` and `gpui-kit.d.ts`; this is native GPUI JavaScript, not HTML, CSS or Node in the view.

### Files and instances

- `main.js`: default-export a `View` with three roles. No props means the headless host; `{launcher:true}` means only the settings button; overlay props mean the settings controller. Render the host as a zero-size element. `mod.json` uses `place: "none"`, title “Discord presence”, and a 560×760 dialog overlay.
- `settings.js`: native `View` using `div`, `image`, `Button`, `Checkbox` with switch semantics, `InputState`, `Input`, and horizontal/vertical flex. Release replaced input states. Keep separate draft, persisted source, busy/error state and last-focused template input. Use native focus handles and accessible labels.
- `presence.js`: pure configuration validation, glob matching, template expansion, privacy and Herdr-data-to-activity mapping, shared by host and preview.
- `bridge.mjs`: dependency-free Node.js 20+ helper; use standard networking, filesystem, crypto, process and event APIs. Support `--start <modDirectory>` spawning a detached `--daemon`, guarded by a singleton socket/named pipe keyed by the real mod-directory path. Do not install npm packages, a web server, scheduled task, or request tokens.
- `discord.svg`: monochrome Discord mark from Simple Icons (CC0), tinted by the launcher. Preview the shared application’s default artwork using shipped `frame/welcome/herdr.png`; this is a local reference, not artwork fetched from Discord. Other keys get labels, not invented images.
- `config.example.json`: shared public application ID `1529832902387302510`, enabled true, no private patterns, large image key `herdr`, harness icon true, Details `{workspace} · {branch}`, State `{harness} · {agents.running}/{agents.total} agents active`, and display type `name`. Copy to the installed mod’s `config.json` before running the host, or save defaults from settings.

### Herdr integration

Read `agents()`, `spaces()`, `terminals()`, `panes()` and `focused()`. Resolve the displayed terminal with `focused().shown ?? focused().terminal`; use that terminal’s pane branch and working directory, falling back to focused cwd. If branch metadata is absent, run `exec("git", ["branch", "--show-current"], {cwd, on})` on its machine, caching that context for ten seconds. Resolve private borrowed-terminal ownership through agent space, pane tab or machine-qualified terminal labels.

Use `appHome()`, `readTextFile()` and compare-and-write `writeTextFile(path, text, previous)` for local configuration/snapshot files. Read configuration on host flush, fail closed to null activity on errors, and serialize concurrent flushes without losing revisions arriving during a write. Live Herdr rerenders mark changes; a one-second timer flushes changed data and renews the heartbeat every ten seconds. Start/check the helper through `exec("node", [bridgePath, "--start", modDirectory])` after snapshot writes. Use fresh callback contexts with `cx.spawn`, `cx.timer` and `cx.notify`, never retained contexts.

Put `.presence.json` (`version:1`, millisecond `updatedAt`, sanitized `activity`) and `.status.json` (state, helper pid, lastAckAt, acknowledged activity, error, updatedAt), including temporary files, under `<appHome>/data/discord-rpc/`, not the watched mod folder. Settings polls status/heartbeat and branch fallback every two seconds and retains the workspace focus captured when opened. The launcher calls `openOverlay` with mod `discord-rpc`, dialog kind, width 560 and height 760; settings uses `props()` and `closeOverlay()`.

There is no bundled layout. To integrate, clone the person’s layout instead of editing a shipped one, then add one headless block to its work column:

```json
{"id":"discord-rpc","type":"block","size":{"px":1},"content":{"mod":"discord-rpc"}}
```

Optionally place the launcher beside the existing shipped `workspace-status` block in a nonresizable 28px row, giving the status weight 1 and launcher width 40. The launcher’s content is `{"mod":"discord-rpc","props":{"launcher":true}}`. No shipped mod is modified or otherwise required for the host. `herdr-app do mod.open --name discord-rpc` also opens settings.

### Discord transport

Run on the same Windows desktop as Discord. Probe named pipes `\\.\pipe\discord-ipc-0` through `9`, send a version-1 client-ID handshake, await READY, and send nonce-correlated `SET_ACTIVITY` with the helper pid. Encode an 8-byte little-endian opcode/length header followed by JSON. Handle split/combined frames, PING/PONG, errors, disconnects, finite five-second READY/ACK timeouts and a 1 MiB frame limit. Record publication only after an ACK. Reconnect at five-second intervals; preserve latest desired state while throttling. Allow an immediate null clear even with a non-null operation pending, without letting its late ACK restore stale status.

Poll the snapshot/config each second; invalid input clears rather than retaining old activity. Reject snapshots over 45 seconds old or over five seconds in the future. Expiry clears, writes stale status and exits. Write status atomically, retrying transient Windows rename locks. Bound shutdown clearing to one second. Keep helper start idempotent; do not leave a daemon alive after lease expiry.

## Watch out

- This publishes workspace and branch names to Discord. It executes local Node and Git (possibly Git on a connected machine), reads live workspace metadata and configuration/runtime files outside its mod folder, and connects to local Discord IPC, through which Discord publishes activity. It does not scrape terminals, publish paths/prompts/titles/commands/machine names, fetch remote artwork, or use a bot/user token.
- Windows Node.js 20+, desktop Discord with activity sharing enabled, and a compatible running Herdr are required. The production helper only probes Windows named pipes, not Linux/macOS Discord sockets. The application ID is public, not a secret; custom image keys must exist in that application. Small keys are `pi`, `claude`, `codex`, `gemini`, `opencode`, `cursor`, `copilot`, shown only with artwork and a single recognized harness.
- Keep exactly one headless host per app home. Multiple windows racing on the same snapshot are unsupported. Settings and launcher must never run host initialization or cleanup. Switching away from the host’s layout clears presence; simply closing settings does not.
- Never write mutable runtime files under `mods/discord-rpc/`: even hidden-file parent-directory notifications can trigger hot-reload loops. Upgrades keep the same singleton identity; an old helper may need its 45-second lease to expire before the new helper starts. A running helper retains its loaded JavaScript.
- Validate the client ID as a 17–20 digit string; booleans as booleans; private patterns as strings; artwork keys as nonblank text up to 128 characters; display type as `name`, `state`, or `details`. Templates allow only `{workspace}`, `{branch}`, `{harness}`, `{agents.running}`, `{agents.total}` and at most 512 characters; reject malformed braces. Sanitize controls, cap rendered lines at 128 Unicode codepoints and branch at 48, preserve default count/branch suffix budgets, and prefix a one-character line with `In `.
- Apply privacy before substitution in both fields, including borrowed terminals with remote/local ID collisions. Literal template text is not privacy-filtered: never hard-code secrets there. Unknown variables must not expose additional metadata.
- The preview shows drafts even when sharing is paused; it is not proof of Discord publication. The acknowledgment line is evidence of IPC acceptance, not a screenshot of the Discord profile. No model detection, per-agent badges, or exact remote-art rendering is implemented.
- Dialog content must scroll at 760px rather than push Save offscreen. Use native inputs/buttons and switch focus handles: a painted switch alone is not keyboard accessible. Read installed type definitions rather than assuming browser APIs exist.

## Done when

- `herdr-app check <folder>/mods/discord-rpc` passes; the installed host, launcher and opened settings render without errors in `herdr-app status`.
- Tests cover configuration/templates, Unicode limits, privacy for local/remote/borrowed terminals, all four agent statuses, root counts, focused branch/harness and non-Git fallback; a private match hides branch/workspace in both lines.
- Changing focused pane/selected workspace updates the sanitized snapshot; working changes the running count, other statuses keep only the total. No-workspace, disabled and invalid configurations produce null activity.
- Settings opens via launcher, command, or the global Ctrl+Alt+D binding without starting another host; the binding works even in a layout without the host or launcher. Insertion replaces the selected range; invalid templates disable Save; Save persists the complete valid draft, Cancel discards it, immediate pause survives Cancel, Reload rereads, and external-write conflicts do not overwrite newer data.
- IPC tests exercise fragmented frames, READY/ACK timeouts, Discord errors, reconnect, coalescing/throttle, immediate pause, stale/future heartbeats, singleton startup, and cleanup. No runtime or temporary writes touch the watched mod tree.
- With desktop Discord running, status records an acknowledged activity matching the intended text. Pause clears; resume/save republishes; removing the host clears or its heartbeat expires. Inspect Discord separately before claiming its profile UI was verified.
- Save a real screenshot of the native settings as `preview.png`, excluding unrelated terminal content. Publish this folder in a public GitHub repository with topic `herdr-mod`, without a `layouts/` folder or personal runtime/configuration files.
