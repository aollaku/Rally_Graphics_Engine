RGE YouTube Primary + Backup Broadcast Engine

This package adds two YouTube modes:

1. MAIN + BACKUP
   MediaMTX input + RGE graphics overlay -> YouTube Primary and YouTube Backup.
   Configure:
   - MAIN: MediaMTX input + RGE graphics -> YouTube PRIMARY
     Destination: rtmp://a.rtmp.youtube.com/live2/YOUR_PRIMARY_STREAM_KEY
   - MAIN: MediaMTX input + RGE graphics -> YouTube BACKUP
     Destination: rtmp://b.rtmp.youtube.com/live2/YOUR_BACKUP_STREAM_KEY

2. GRAPHICS ONLY + BACKUP
   RGE output only -> YouTube Primary and YouTube Backup.
   Configure:
   - Graphics Only -> YouTube PRIMARY
     Destination: rtmp://a.rtmp.youtube.com/live2/YOUR_PRIMARY_STREAM_KEY
   - Graphics Only -> YouTube BACKUP
     Destination: rtmp://b.rtmp.youtube.com/live2/YOUR_BACKUP_STREAM_KEY

Controller buttons:
- Start YouTube Main + Backup
- Start YouTube Graphics + Backup
- Stop All Outputs

Important:
- Do not stream the Chromium sign-in page. Graphics-only mode opens the RGE output URL in kiosk/app mode and captures only that output.
- For Main mode, publish your camera/programme feed into MediaMTX first, normally:
  rtmp://SERVER_IP:1935/live
  or SRT publish path live.
- Keep stream keys private.
