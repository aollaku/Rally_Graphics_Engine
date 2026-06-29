Preview / Program target fix

This build restores the scene-engine features (bugs/sponsor layer, clock layer, macros, Preview/Program labels) and adds separate graphics trigger targets.

Controller workflow:
- Tick Preview to send selected graphics only to /preview.
- Tick Live Output to send selected graphics only to /output.
- Tick both to send the same selected graphic to both Preview and Live Output.
- Open Preview opens the HTTP preview page, same style as Open Output.

Pages:
- HTTP Output:  http://HOST:8080/output/live
- HTTP Preview: http://HOST:8080/preview/live
- HTTPS controller can still show its internal preview iframe using /preview/live.
