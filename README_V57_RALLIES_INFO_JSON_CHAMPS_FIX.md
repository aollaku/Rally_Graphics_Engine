# V57 — Rallies.info JSON Champs Fix

This build changes only the Entry List championship enrichment.

- Uses the operator-entered Rallies.info event URL.
- Derives and requests `entries_get.php?type=s&combined=0&mixed=0`.
- Matches DJames Entry List rows to Rallies.info by official entry number (`no`).
- Reads championship codes from `champ_d` and `champ_n`.
- Maps those codes to the configured full championship names.
- Keeps DJames as the source for all existing Entry List fields and all other graphics.
- Does not change layouts, stage parsing, overall parsing, pagination, controller workflow, or broadcast logic.

Verified source structure for entry 207:
- `no`: 207
- `champ_d`: BS
- `champ_n`: BS
