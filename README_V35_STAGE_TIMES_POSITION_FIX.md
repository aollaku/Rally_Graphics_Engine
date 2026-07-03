# V35 Stage Times Position Fix

Parser-only update.

- Stage Times/Stage Results now read the competitor number from the Stage Classification `No.` column, not the `+/-` movement column.
- This fixes Stage Times row drift on Stage 2 and other stages/pages.
- Tied positions such as `5=` and `17=` continue to display as `5` and `17` only.
- Driver and co-driver display cleanup remains active so leading competition numbers are not shown in name boxes.
- No layout, controller, broadcast, pagination, or data source workflow changes.
