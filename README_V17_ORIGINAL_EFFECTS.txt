V17 Original Effects Revert

This build reverts the graphics animation/output renderer back to the original effects from before the slowdown/double-buffer/no-blank-swap experiments.

Kept features:
- Same PC controller layout
- Same tablet controller layout
- Login and user management
- Default superadmin / superadmin123
- PostgreSQL
- NGINX
- Backup/export/import database
- Pagination for overall/stage/entries
- Rundown controls
- Clear graphic

Removed/reverted:
- Slower broadcast swap timing
- Extra swap delay
- Double-buffer/no-blank swap experiments
- Broadcast animation settings experiments

Run:
  docker compose up -d --build

Open:
  PC:     http://localhost:8080/controller
  Tablet: http://localhost:8080/tablet
  Output: http://localhost:8080/output/live
