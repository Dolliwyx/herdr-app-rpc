# Discord presence settings

## Native visual authority

Inherit Herdr's current theme and UI font through `theme()` and GPUI primitives. Use `popover` for the dialog, `background` for inputs and the activity preview, `raised` for secondary actions, `solid`/`solid_foreground` for the primary action, and `accent` for selection and keyboard focus. Do not hard-code a dark theme or Discord's palette.

The dialog is a single 560px-wide column, capped at 760px high, with a scrolling body and persistent header/footer. Use 18px outer padding, 13px body text, 12px explanatory text, and a 16px semibold title. Group controls with 6–8px gaps and give section headings extra space above. Inputs and buttons use 6px corners; the activity preview uses 8px corners.

A Discord-logo-only button in a 40px block in the custom layout's bottom-right status bar opens the dialog. Keep the “Discord presence” tooltip and “Discord presence settings” accessible name. The 18px mark inherits the theme's text color. Its `launcher: true` instance never runs a presence host. A separate tab-owned pane with `presenceHost: true` hosts presence and can be resized to zero width after initialization. At a readable width, it shows a short explanation, the startup limitation, and a native Presence settings button using the same theme and typography.

## Hierarchy and behavior

1. Title, connection status, a Create RPC pane recovery button (Go to RPC pane when one exists), and sharing toggle. Pane recovery preserves the settings draft and uses the existing native button style.
2. Draft preview: compact member-list status and expanded activity text; distinguish it from Discord-acknowledged activity. Local artwork is a reference, not a remote rendering.
3. Presence text: member-list display selection, Details and State templates, a State shuffle checkbox/switch with a whole-minute interval (default 3, range 1–1440), editable alternatives with Add template/Remove, insertion buttons targeting the last focused template, and Reset text. Shuffle includes the main State template; disabling it preserves alternatives. Focusing an alternative while shuffle is on previews that template. Reset text clears alternatives and disables shuffle.
4. Workspace privacy rules, then appearance preferences.
5. Advanced application ID and image asset key, collapsed initially.
6. Reload, Cancel, and Save remain visible below the scrolling body.

All controls use native keyboard-operable primitives, accessible names, and visible focus. The switch-shaped controls use the checkbox primitive with switch semantics so the control and its focus-ring wrapper can share a native focus handle.

Draft changes affect the preview only until Save. Pausing persists immediately, without publishing other draft changes; Cancel does not undo a pause. Show validation errors before saving and preserve the draft on write conflicts. Privacy is applied before variable interpolation in both activity fields. Empty selected status text falls back to Herdr.
