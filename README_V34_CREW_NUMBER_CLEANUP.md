# Rally Graphics v34 — Crew Number Cleanup

Scope: parser/display field cleanup only.

Changes:
- Prevents competition/car numbers from appearing at the start of Driver names.
- Prevents competition/car numbers from appearing at the start of Co-driver names.
- Applies to all rally table graphics:
  - Overall Leaderboard
  - Stage Results
  - Stage Times
  - Entry List

No changes made to:
- DJames scraping URLs
- table selection logic
- stage/page logic
- controller behaviour
- broadcast engine
- output routing
- graphic layout/CSS design
