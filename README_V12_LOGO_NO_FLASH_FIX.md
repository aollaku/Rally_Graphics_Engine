# V12 Logo No-Flash Fix

Fixes the remaining logo flashing by stopping the output/preview page from re-applying the whole scene overlay every second.

Changes:
- The once-per-second timer now updates only the clock text.
- Logo DOM/image is updated only when the selected logo actually changes.
- Runtime logo alpha processing is triggered only on the initial image load, not every state tick.
- Logo-only mode removes overlay background, border, padding and shadow so the PNG is clean.

No controller layout changes.
