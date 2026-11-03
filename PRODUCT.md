# Product

<!-- impeccable:product-schema 1 -->

## Platform

Native desktop (GPUI) host pane and settings inside Herdr, with a dependency-free Windows Node.js Discord helper. There is no DOM, CSS, or separate web application.

## Users

Herdr users who want Discord presence to keep updating across tab and layout switches, with configuration inside Herdr and no OS login service.

## Product Purpose

Publish useful Herdr activity on Discord while giving users control over workspace-name privacy, text, artwork, and whether sharing is enabled.

## Operating Context

A tab-owned mod pane starts the presence host only with `props.presenceHost: true`. Once shown, Herdr keeps that pane alive across tab and layout switches. The host reads native Herdr APIs, refreshes sanitized activity and a heartbeat at least every ten seconds, and starts the Windows Discord named-pipe helper. Closing the pane or Herdr ends hosting; the helper clears and exits after heartbeat expiry if immediate cleanup cannot finish. No Windows Scheduler task or startup launcher is created.

For invisible operation, initialize the host pane and resize it to zero width with `layout.resize`; keep `hidden` unset/false. Herdr still scans a zero-width pane for initialization, unlike `layout.hide` or `hidden: true`. The host controls remain available by resizing it wider. An inactive restored mod pane still does not initialize until its tab is shown. This is an explicit app-only startup compromise, not a global startup hook. Keep exactly one host pane per app home; multiple host panes/windows are unsupported. Settings overlays and optional launchers never host or clear presence. Configuration remains in the installed mod’s `config.json`; runtime state stays under `data/discord-rpc/`.

## Capabilities and Constraints

Settings include enabled, privatePatterns, largeImageKey, showHarnessIcon, clientId, Details/State templates, optional Details alternatives shuffled without immediate template repeats at a configurable whole-minute interval (3 minutes by default), and a member-list display selector. Privacy patterns are case-insensitive whole-name globs supporting `*` and `?`. Matching selected or borrowed-terminal owner workspaces appear as Private workspace and omit their branch; harness and counts remain visible. Native focus data covers borrowed terminals and layout terminal blocks, shared by publication and preview. Raw paths, terminal titles, prompts, commands, and machine names are not published. Status files distinguish connection state from Discord-acknowledged activity.

Saves apply draft settings together; turning sharing off pauses without waiting for the non-null publish throttle. Existing local configuration and unrelated settings must be preserved. Restarting the live app or core is not required for verification.

Windows is the current deployment target. macOS/Linux Discord transport and a possible native app-wide startup hook are explicitly deferred in `BACKLOG.md`.

## Brand Commitments

Inherit Herdr’s existing interface rather than create a separate visual identity.

## Evidence on Hand

`README.md`, `RECIPE.md`, the example configuration, host/bridge code, and automated tests describe supported behavior. A Discord acknowledgment is evidence of IPC acceptance, not a visual profile check.
