# V36 - Graphics Settings Cleanup + Logo Delete

Changes only in controller/settings behaviour and logo asset management.

## Graphics Settings
- Re-enabled predictable Scale / X / Y / Width / Height controls for graphics output.
- Width/Height now use 1920x1080 design units where 1920x1080 = full output canvas, preventing the old chaotic crop/shift behaviour.
- Per-graphic scopes remain supported: Global, Overall, Stage Results, Stage Times, Entry List, Bug, Clock.
- Reset now resets all graphics settings and all per-graphic overrides cleanly.
- Fixed the animation setting label bug.

## Logo management
- Added Delete Logo button in the Logo Library area.
- Deleting a logo removes it from the uploaded files and clears it from the active scene if it was selected.
- Existing upload, logo slot, preview and TAKE logic are preserved.

No rally data parsing changes were made.
No stage/page/controller TAKE/CUT logic was changed.
No graphics template layout changes were made.
