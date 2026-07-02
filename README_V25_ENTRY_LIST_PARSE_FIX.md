# V25 Entry List Parser Fix

This build changes only the Entry List parser.

Fix:
- The DJames Entry List table is now parsed using its real columns:
  No | Entrant/Sponsor | BTRDA | Driver | Nat | Town | Co-Driver | Nat | Town | Car | Class
- Sponsor/entrant names are no longer placed in the Driver column.
- Driver, Co-driver, Car, Class and championship text are preserved correctly.

No controller layout, stage parser, stage results, stage times, logo, page selector, or broadcast engine behaviour was changed.
