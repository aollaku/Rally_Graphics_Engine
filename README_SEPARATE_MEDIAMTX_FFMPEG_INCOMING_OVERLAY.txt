RGE Separate MediaMTX + FFmpeg Incoming Stream Overlay Engine
=============================================================

This build keeps the normal RGE renderer untouched:

- Output Live remains graphics-only.
- Output Preview remains graphics-only.
- Controller Preview remains graphics-only.
- No designer/editor/layout code changes are used for the broadcast pipeline.

The broadcast workflow is separate:

Incoming stream -> MediaMTX container -> FFmpeg Engine container -> RGE graphics overlay -> YouTube Primary + Backup

Containers
----------

The docker-compose file now separates the main roles:

1. app1 / app2
   RGE controller, preview, output pages and API.

2. mediamtx
   Stream hub for receiving and redistributing RTMP, RTSP, SRT, HLS and WebRTC.

3. ffmpeg-engine
   Dedicated FFmpeg/Chromium/Xvfb container for rendering the graphics layer and encoding the outgoing programme stream.

4. nginx
   HTTPS controller / HTTP output proxy as before.

Incoming stream examples
------------------------

Publish RTMP into MediaMTX:

  rtmp://SERVER_IP:1935/live

Publish SRT into MediaMTX:

  srt://SERVER_IP:8890?streamid=publish:live&mode=caller

Read the live path internally from FFmpeg:

  rtmp://mediamtx:1935/live

or:

  rtsp://mediamtx:8554/live

or:

  srt://mediamtx:8890?streamid=read:live

How to use in RGE
-----------------

1. Start the stack:

   docker compose up -d --build

2. Open the RGE controller.

3. Go to Broadcast Engine.

4. In Incoming Stream Input, set:

   Protocol: RTMP
   Incoming URL: rtmp://mediamtx:1935/live
   MediaMTX Path: live
   Overlay RGE Graphics: enabled

5. Press:

   Use Incoming Stream For Overlay Outputs

6. Configure YouTube:

   YouTube Primary:
   rtmp://a.rtmp.youtube.com/live2/YOUR_PRIMARY_STREAM_KEY

   YouTube Backup:
   rtmp://b.rtmp.youtube.com/live2/YOUR_BACKUP_STREAM_KEY

7. Press:

   Start YouTube Main + Backup

Graphics-only YouTube
---------------------

For graphics-only streaming, do not use the incoming stream input.
Use:

  Start YouTube Graphics + Backup

This sends the RGE output as the programme source without a live input.
Remember: YouTube/RTMP does not support transparency. Graphics-only output must be encoded as a normal opaque video frame.

Important notes
---------------

- The FFmpeg container uses the RGE graphics URL:

  http://app1:3000/output/live

- The incoming stream default URL is:

  rtmp://mediamtx:1935/live

- The normal RGE output pages are not altered by this workflow.
- The broadcast engine is only used when you press Start on a broadcast output.
- Stream keys should not be committed or shared.
