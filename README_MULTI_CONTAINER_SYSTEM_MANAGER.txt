RGE Multi-Container System Manager
==================================

This version changes the Health / Status page for a proper multi-container deployment.

What changed
------------
- The app now reads Docker container state from Docker itself through /var/run/docker.sock.
- Nginx is judged by container status, not by a fragile internal HTTP/DNS probe.
- MediaMTX is split into:
  - container status
  - API status
  If the MediaMTX container is running but the API is not reachable, it shows warning/orange instead of a false red container failure.
- FFmpeg Engine shows:
  - yellow/idle when online with 0 jobs
  - green/running when jobs are active
  - orange when container is running but API is not reachable
  - red when the container is stopped/failed
- Backup is no longer counted as a failed active service. It is shown as optional/background.
- Docker container details are shown in the Health page.

Important
---------
The app containers mount the Docker socket read-only:

  /var/run/docker.sock:/var/run/docker.sock:ro

This allows the controller to read container status without needing Docker CLI inside the app container.

Restart
-------
Run:

  docker compose down
  docker compose up -d --build

Then open the controller through nginx:

  HTTPS control: https://localhost:8443
  HTTP graphics output: http://localhost:8080/output/live

Notes
-----
The output live/preview renderer was not changed.
This update only changes health/status logic and the Docker-based service monitor.
