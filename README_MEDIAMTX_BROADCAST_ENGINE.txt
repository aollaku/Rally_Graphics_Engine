RGE MediaMTX + FFmpeg Broadcast Engine
=====================================

This build adds MediaMTX to receive and redistribute streams, plus FFmpeg workflows to add RGE graphics over an incoming stream and send the result to YouTube/RTMP.

Start the stack:
  docker compose up --build

MediaMTX ports:
  RTMP ingest/playback: 1935
  RTSP: 8554
  HLS: 8888
  WebRTC: 8889
  SRT: 8890/udp
  MediaMTX API: 9997

1) Send your clean video stream into MediaMTX
--------------------------------------------
RTMP publish example:
  rtmp://YOUR_SERVER_IP:1935/live

SRT publish example:
  srt://YOUR_SERVER_IP:8890?streamid=publish:live&mode=caller&latency=120000

RTSP publish example:
  rtsp://YOUR_SERVER_IP:8554/live

2) Add RGE graphics and stream to YouTube
-----------------------------------------
Open the controller, go to Broadcast Engine, use:
  YouTube: MediaMTX Stream + RGE Graphics

Input override:
  rtmp://mediamtx:1935/live

Destination:
  rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY

Press Save, then Start.

This workflow takes the incoming MediaMTX video as the base layer, renders the RGE graphics output in Chromium/Xvfb, keys the black background away, overlays the graphics, then encodes to YouTube via FFmpeg.

3) Send graphics-only output into MediaMTX
------------------------------------------
Use:
  Publish RGE Graphics to MediaMTX

Destination:
  rtmp://mediamtx:1935/rge_graphics

Then you can watch it as:
  RTMP: rtmp://YOUR_SERVER_IP:1935/rge_graphics
  HLS:  http://YOUR_SERVER_IP:8888/rge_graphics/index.m3u8
  RTSP: rtsp://YOUR_SERVER_IP:8554/rge_graphics

4) Send MediaMTX clean stream to YouTube without graphics
---------------------------------------------------------
Use:
  YouTube: MediaMTX Stream Only

Input override:
  rtmp://mediamtx:1935/live

Destination:
  rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY

Notes
-----
- Do not share screenshots that show your YouTube stream key.
- The overlay workflow keys black as transparent. Keep the RGE output background black/transparent for best results.
- This is designed to run without OBS.
