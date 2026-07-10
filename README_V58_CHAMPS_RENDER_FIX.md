# V58 — Champs render fix

The Rallies.info JSON importer in v57 was working, but the output renderer still contained a hard-coded `champText()` function that always returned an empty string.

This build changes only the Entry List output renderer so it displays `championshipText` supplied by the server. It does not change DJames parsing, pagination, graphics layout, stage results, stage times, overall results, broadcast engine, or controller logic.

Verified source fields:
- Rallies.info endpoint: `entries_get.php?type=s&combined=0&mixed=0`
- Entry match key: `no`
- Championship fields: `champ_d`, then `champ_n`
