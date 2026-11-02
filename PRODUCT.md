# Product

<!-- impeccable:product-schema 1 -->

## Platform

Native desktop (GPUI).

Configuration lives inside Herdr using its native mod UI. There is no DOM, CSS, or separate web application.

## Users

Herdr users configuring their Discord presence from inside Herdr.

## Product Purpose

Publish useful Herdr activity on Discord while giving users control over workspace-name privacy and whether presence is enabled.

## Operating Context

The existing integration is a headless Herdr mod with a dependency-free Node helper on the Windows desktop running Discord. Configuration currently lives in the installed mod's config.json.

## Capabilities and Constraints

Existing settings: enabled, privatePatterns, largeImageKey, showHarnessIcon, and clientId. Privacy patterns are case-insensitive whole-name globs supporting * and ?. Matching workspaces appear as Private workspace and omit their branch; harness and counts remain visible. Raw paths, terminal titles, prompts, commands, and machine names are never published. Status files distinguish connection state and Discord-acknowledged activity.

The user approved implementation of the in-Herdr settings dialog, including privacy-safe variables in Details and State and a member-list display selector (app name, State, or Details). Saves apply draft settings together; turning sharing off pauses immediately. Existing local configuration and unrelated settings must be preserved. Restarting the live app or core is not part of implementation verification.

## Brand Commitments

Inherit Herdr's existing interface rather than create a separate visual identity.

## Evidence on Hand

README.md, mods/discord-rpc/config.example.json, and the current mod implementation describe supported configuration and behavior.
