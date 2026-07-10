# v56 – Rallies.info Champs field

Based on the uploaded v45 Dynamic Page Count / no-Champs build.

Changes are limited to the Entry List Champs field:

- DJames remains the source for entry number, driver, co-driver, car, class and pagination.
- A Rallies.info Entry URL field is available beside Current Event.
- Rallies.info championship codes are parsed from the seeded entry table and matched by official entry number.
- Driver and co-driver championship codes are combined without duplicates.
- Known codes are expanded to the requested full championship names.
- No fallback to the old DJames championship text: if the Rallies.info fetch or match fails, Champs remains blank.
- Entry API responses expose `champsRowsParsed`, `champsRowsMatched` and `champsError` for diagnosis.
- Stage Times, Stage Results and Overall parsing are unchanged.

Example URL:
`https://www.rallies.info/webentry/2026/nickygrist/entries?type=s`
