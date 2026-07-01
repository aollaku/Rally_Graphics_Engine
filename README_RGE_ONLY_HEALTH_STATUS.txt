RGE-only Health Status update

Changes in this build:
- Removed the generic Docker container list from the Health panel.
- Health now reports only the services used by this RGE application:
  - RGE Controller
  - RGE Worker (if enabled)
  - Nginx Reverse Proxy (if enabled)
  - Postgres Database
  - FFmpeg Engine
  - MediaMTX
- Backup worker is no longer shown as a failed service.
- Optional services that are not enabled show as grey/optional instead of red errors.
- FFmpeg idle is shown as idle/yellow, not as an error.
- MediaMTX separates running container/API/path state without affecting Output Live or Output Preview.
- Added a small Broadcast Status summary for input, graphics, and output jobs.

Restart after installing:

docker compose down
docker compose up -d --build
