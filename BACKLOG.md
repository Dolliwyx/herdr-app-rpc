# Backlog

## Deferred: macOS and Linux

Windows RPC hosted by a tab-owned Herdr mod pane is the current scope. macOS/Linux support is not implemented or verified.

- Add Discord Unix-socket discovery instead of Windows named pipes, including Linux sandboxed Discord installations where appropriate.
- Verify native Herdr collection, focus behavior, privacy, hidden-pane updates, pause/cleanup, and Discord acknowledgment on each OS.
- Keep startup app-scoped: no OS login service is required by the pane-host design.

Keep the shared native host/presence/bridge logic where possible. Do not advertise cross-platform support until transport and end-to-end checks pass.

## Optional: native app-wide mod startup

Herdr currently initializes mod panes only when their tab is shown. A zero-width host pane can remain invisible without setting `hidden: true`, preserving initialization when its tab is selected. Once loaded, a tab-owned pane survives tab and layout switches, but an inactive saved pane does not start automatically.

A future native Herdr background-mod startup hook could remove the need to visit the host tab after launching the app. This would require an upstream app change; do not replace it with Scheduler tasks, OS login services, or hidden external launchers.
