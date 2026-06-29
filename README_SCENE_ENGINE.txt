Rally Graphics Scene Engine Build

Added on top of the stable flicker-fix/config-import-export app:

1. Scene Manager tab/card in the controller
   - Preview graphic
   - Program graphic
   - TAKE Preview -> Program
   - Clear Program
   - Transition selector: Cut/Fade/Slide/Wipe

2. Layer support
   - Main layer opacity
   - Bug/Sponsor text layer
   - Clock layer

3. Macro support
   - Macro: Clear Program
   - Macro: Take Preview
   - API endpoints for future custom macros

4. Remote control API
   POST /api/remote/trigger
   Body examples:
   { "action":"clear" }
   { "action":"takePreview" }
   { "action":"preview", "graphic": { "type":"overall", "page":1, "pageSize":10 } }
   { "action":"take", "graphic": { "type":"stageTimes", "stageId":1, "page":1, "pageSize":10 } }

5. Existing workflow still works
   The old quick buttons still take graphics directly to Program.
   The new Scene Manager is an additional professional workflow, not a replacement.
