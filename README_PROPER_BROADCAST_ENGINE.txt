RGE Proper Broadcast Engine - MediaMTX + FFmpeg + RGE Overlay
=============================================================

This package fixes the previous mistake where YouTube could receive the Chromium sign-in page.
The correct workflow is now:

  Incoming video stream -> MediaMTX -> FFmpeg overlay with RGE graphics -> YouTube/RTMP

Chromium is only used internally to render the transparent RGE HTML graphics layer.
It is NOT used as the programme video source.

Quick start
-----------

1) Start the system:

   docker compose up -d --build

2) Send your live programme/camera feed into MediaMTX.

   RTMP publish target:

     rtmp://SERVER_IP:1935/live

   SRT publish target:

     srt://SERVER_IP:8890?streamid=publish:live&mode=caller

   RTSP publish target:

     rtsp://SERVER_IP:8554/live

3) Open the RGE controller:

   https://SERVER_IP:8443

4) Take your rally graphic to output as normal.

5) In Broadcast Engine, use this profile:

   MAIN: MediaMTX input + RGE graphics -> YouTube

   Input override:

     rtmp://mediamtx:1935/live

   Destination:

     rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY

6) Press Save Engine Config, then Start on that profile.

What this sends to YouTube
--------------------------

- Base video: the stream coming from MediaMTX path /live
- Graphics: RGE output page rendered internally at 1920x1080
- Audio: passed from the incoming MediaMTX stream
- Encoder: FFmpeg H.264 + AAC, FLV/RTMP

Useful MediaMTX playback URLs
-----------------------------

RTMP playback:

  rtmp://SERVER_IP:1935/live

HLS playback:

  http://SERVER_IP:8888/live/index.m3u8

RTSP playback:

  rtsp://SERVER_IP:8554/live

WebRTC page/API:

  http://SERVER_IP:8889/live

Notes
-----

- If YouTube shows a Chromium sign-in screen, you started the wrong profile.
  Use MAIN: MediaMTX input + RGE graphics -> YouTube.

- The profile called Graphics only -> YouTube streams only the RGE output page.
  It is useful for testing graphics but not for adding graphics over a live video stream.

- For best YouTube results, use 1920x1080, 50 fps, 6000k to 9000k video bitrate.

- Keep your YouTube stream key private.
