RGE Live Container Health Monitor
=================================

This build adds FFmpeg Engine and MediaMTX monitoring to the Health / Status panel.

What changed
------------
- Health panel now shows:
  - RGE Controller
  - PostgreSQL
  - Internet / rally data
  - Preview Output
  - Program Output
  - FFmpeg Engine
  - MediaMTX
  - Container / service summary
- The Health panel refreshes automatically every 5 seconds.
- FFmpeg jobs are listed with running/stopped status and PID.
- MediaMTX paths are listed with ready/idle status and reader count.

How it works
------------
The RGE app checks:
- FFmpeg Engine: FFMPEG_ENGINE_URL, default http://ffmpeg-engine:3100/status
- MediaMTX API: MEDIAMTX_API_URL, default http://mediamtx:9997/v3/paths/list

The normal graphics renderer, Output Live, Output Preview and Controller Preview were not changed.
