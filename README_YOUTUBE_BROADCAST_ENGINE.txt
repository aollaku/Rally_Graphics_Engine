RGE YouTube Broadcast Engine
============================

This build includes the runtime elements needed to stream the RGE output to YouTube without OBS when running in Docker:

- FFmpeg encoder
- Chromium browser renderer
- Xvfb virtual display
- fonts for clean HTML graphics rendering
- scripts/rge-stream-browser.sh

How it works
------------
The Broadcast Engine opens the RGE output page in Chromium inside a virtual 1920x1080 display, captures it with FFmpeg, encodes H.264/AAC, and sends it to YouTube RTMP.

Recommended YouTube destination format
--------------------------------------
In the YouTube output card, set Destination to:

rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY

Keep the stream key private. Do not screenshot it.

Recommended settings
--------------------
Input URL:
http://127.0.0.1:3000/output/live

Width: 1920
Height: 1080
Frame Rate: 50
Video Bitrate: 6000k to 9000k
Audio Bitrate: 160k

Docker
------
The Dockerfile installs FFmpeg, Chromium and Xvfb automatically.

Build and run:

docker compose up --build

Then open the HTTPS controller, go to Broadcast Engine, configure YouTube destination, Save Engine Config, then Start on YouTube.

Notes
-----
- This sends video with silent AAC audio unless the graphics page/browser provides audio.
- NDI still requires a special FFmpeg build with libndi support and is not included in the standard Alpine FFmpeg package.
- YouTube must have a live stream created and ready before you press Start.
