Config Import / Export update

- Removed Backup/Restore controls from the controller interface.
- Added Export Full Config and Import Full Config.
- Full Config includes:
  - current event/app state
  - graphics settings: resize, opacity, blur, animation speed, easing, position, size
  - rundowns
  - stored rally event/results data exported from the database
- Import can Merge or Replace stored data.
- Existing DB JSON import/export remains available for database-only transfers.
