# v22 Stage Classification Left Table Repair

Rebuilt from v21 and changed only the stage classification parser.

Fixes:
- Stage Results and Stage Times parse the LEFT Stage Classification segment of each DJames row.
- The right-side Overall Classification segment is ignored for these two graphics.
- Multiple competitors/pages are restored because the parser scans every result row, not only the wrapper table.
- Controller layout and previous stable functionality are unchanged.
