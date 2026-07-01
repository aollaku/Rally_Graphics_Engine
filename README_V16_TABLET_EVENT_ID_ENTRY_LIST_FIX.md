# V16 Tablet Event ID + Entry List Title Fix

Changes:

1. Tablet controller top-left `I.D.` static box is now a manual Event I.D. input.
   - Operators can type an Event I.D. directly.
   - The number spinner can move through previous/next event IDs.
   - Press Enter, change the value, or press refresh to load the event.

2. Entry List graphic title cleanup.
   - Removed the black horizontal title line above `ENTRY LIST`.
   - This affects preview, program output, and tablet preview because the renderer template was updated.

Based on v15 stable stage selector fix.
