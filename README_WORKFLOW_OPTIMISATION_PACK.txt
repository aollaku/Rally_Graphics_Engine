Rally Graphics Workflow Optimisation Pack

Added from the latest fine-adjust-arrows build:

1. Undo / Redo in Graphics Settings
   - Undo and Redo buttons for resize, position, opacity, look and animation changes.

2. Named graphics presets
   - Save, load and delete named presets.
   - Presets are included in Full Config export/import.

3. Per-graphic settings
   - Graphics Settings now has a Settings Scope selector:
     Global Default, Overall, Stage Results, Stage Times, Entry List.
   - This lets different graphic types have different size/opacity/animation settings.

4. Stronger Preview / Program workflow
   - Existing Preview / Program separation is preserved.
   - Keyboard shortcuts can trigger Preview, Take Preview, Clear and Open outputs.

5. Operator Lock Mode
   - Disables designer controls during live operation to avoid accidental changes.
   - Included in Full Config export/import.

6. Health / Status page with LEDs
   - Green = online
   - Orange = warning
   - Red = offline
   - Checks application API, Postgres database, rally data/internet, preview output, program output and config version.

7. Simple Error Viewer
   - Human-readable messages, not JSON.
   - Examples: Postgres database not online, No internet connection, Connection is slow or timed out.

8. Config versioning
   - Full config export is now version 3 and includes appVersion.
   - Export includes users, graphics settings, per-graphic settings, UI settings, shortcuts, presets and database data.

9. Safe area guides
   - Toggle title safe, action safe and centre lines on preview/program output.

10. Configurable keyboard shortcuts
   - Configure key bindings in Settings.
   - Defaults:
     Space = Take current graphic
     Esc = Clear selected target
     P = Send current graphic to Preview
     T = TAKE Preview to Program
     F8 = Open Preview
     F9 = Open Program Output

Run:
npm install
npm start
