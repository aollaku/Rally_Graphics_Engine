Phase 9 - Broadcast Engine

Added a real FFmpeg process manager to the Rally Graphics controller.

Controller UI:
- Broadcast Engine card
- Global FFmpeg path and input source
- Width/height/framerate/bitrate settings
- Start/Stop controls for NDI, SRT, YouTube, Facebook, Twitch, and local recorder
- Per-output destination and extra FFmpeg arguments
- Live running/stopped status and process logs

Backend API:
- GET  /api/broadcast-engine
- POST /api/broadcast-engine
- POST /api/broadcast-engine/start/:key
- POST /api/broadcast-engine/stop/:key
- POST /api/broadcast-engine/stop-all

Notes:
- NDI requires an FFmpeg build compiled with libndi_newtek support.
- RTMP/SRT require valid destination URLs and reachable network endpoints.
- This does not change the graphics renderer layout, preview shape, or output positioning.
