# V26 Data field separation fix

This build only changes the backend result parsers. No graphic layout, controller layout, buttons, styling, or broadcast engine behaviour was changed.

Fixes:
- Stage Results: keeps co-driver and car as separate fields.
- Stage Times: keeps the car only on the existing grey car strip, not appended after the co-driver name.
- Entry List: parses by table headers/direct cells so Driver, Co-driver, Car, Class, and Champs do not shift when DJames rows contain nationality/town/entrant columns.
- Entry List: avoids town/car text being merged into the driver or co-driver boxes.
