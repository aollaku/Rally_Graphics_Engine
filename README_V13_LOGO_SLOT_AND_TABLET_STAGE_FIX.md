# V13 Logo Slot + Tablet Stage Selector Fix

Fixes two live-controller issues:

1. Logo output was able to keep a stale/previous selected logo after multiple uploads.
   - Program/Preview logo URLs are now target-specific.
   - Clearing logo also clears the stored target URL.
   - The output renderer no longer falls back to an old designer logo URL when the target logo URL is empty.
   - Tablet Logo 1/2 still use the first two uploaded PNG logos as fixed slots.
   - Desktop Logo TAKE without a tablet slot uses the logo selected in the main controller library.

2. Tablet stage selector was changing the selected GFX to Stage Results Full.
   - Pressing a stage number now only changes the selected stage/page for the currently selected GFX.
   - If O/A Leaderboard is selected, it stays on O/A Leaderboard.
   - If Stage Results Full/Small is selected, it stays on that selected button.
