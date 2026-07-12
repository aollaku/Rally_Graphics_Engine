# V60 — Main/Tablet Event Synchronisation

- Tablet controller now loads the existing shared application state before requesting event data.
- Opening the tablet no longer overwrites the main controller's Event ID or Rallies.info URL with defaults.
- Event ID and Rallies.info URL changes made on the main controller are pushed to the tablet through the existing shared Socket.IO state.
- Added a Rallies.info Entry URL field to the tablet controller.
- Event changes made on the tablet are saved to the same shared state and reflected on the main controller.
- Preview/program graphics and layer status continue to synchronise without forcing the tablet's local GFX/stage/page selector to jump.
- No changes to result parsing, graphics layouts, pagination, or broadcast output rendering.
