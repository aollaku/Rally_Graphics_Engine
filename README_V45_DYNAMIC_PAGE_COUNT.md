# v45 Dynamic Page Count

Changed the page selector from a fixed maximum of 9 pages to dynamic pagination for all table graphics.

## Behaviour
- Entry List: pages are calculated from the total number of entries, 10 rows per page.
- Overall Leaderboard: pages are calculated from total rows, 10 rows per page.
- Stage Results: pages are calculated from total stage rows, 10 rows per page.
- Stage Times: pages are calculated from total stage rows, 10 rows per page.
- Main controller and tablet controller now generate page buttons based on the real total page count.
- ALL [AUTO] now runs through all generated pages, not only 1–9.

No parser, layout, graphics design, broadcast engine, logo logic, or data mapping changes were made.
