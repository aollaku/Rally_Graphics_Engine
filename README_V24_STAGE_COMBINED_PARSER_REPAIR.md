# V24 Stage Classification Repair

This version keeps the stable controller/layout and changes only the stage data parser.

Fixes:
- Stage Results and Stage Times now prefer DJames `combined.php` with `show_codrivers=1&show_vehicles=1`.
- The parser reads only the left Stage Classification table.
- Co-driver and car are parsed from the Stage Classification row when present.
- Missing co-driver/car fields are enriched from the same page Overall Classification and Entry List, without replacing the left-table stage time/order.
- Other stages are fetched by `StageID`, restoring rows/pages for stages 2, 3, 4, etc.

No layout changes were made.
