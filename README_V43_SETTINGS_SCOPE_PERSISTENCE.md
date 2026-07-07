# V43 Settings Scope Persistence Fix

This build fixes the Graphics Settings scope selector resetting back to Global Default.

Changes:
- Settings Scope is now remembered in browser localStorage.
- Changing graphic/page/stage or receiving live websocket updates no longer forces the scope back to Global Default.
- Websocket graphics-settings updates now refresh the currently selected scope instead of overwriting the active per-graphic view.

No changes were made to:
- rally data parsing
- graphics table layouts
- entry/stage/overall pagination
- broadcast engine
- tablet controller
