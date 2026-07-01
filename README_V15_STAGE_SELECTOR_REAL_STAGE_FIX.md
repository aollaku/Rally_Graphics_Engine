# V15 - Tablet Stage Selector real stage fix

Fixes the tablet controller issue where pressing Stage Selector 1-20 still showed the first stage/page in preview/program/output.

Changes:
- Updated DJames/BTRDA scraper URLs to send the selected stage using `ls=<stage number>` instead of leaving `ls=0`.
- Kept `StageID=<stage number>` for compatibility.
- Added cache-busting/no-store to controller API calls.
- Tablet Stage Selector now keeps the currently selected GFX button and changes only the selected stage.
- Bumped controller JS version to v15 so browsers/tablets load the new file.
