# v23 Stage Classification all-stages + crew enrichment fix

- Keeps the stable v22 controller/layout.
- Stage Results and Stage Times still use the left Stage Classification table only.
- Fixes missing co-driver/car by matching Stage Classification drivers against the Entry List by driver name if the entry number match is wrong or ambiguous.
- Adds DJames stage URL fallbacks and chooses the candidate with the most Stage Classification rows, so Stage 2/3/etc do not return empty tables when one URL variant has no rows.
