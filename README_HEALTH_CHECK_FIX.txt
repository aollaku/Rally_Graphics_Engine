RGE Health Check Fix
====================

This build fixes false MediaMTX/container errors in the Health page.

Changes:
- MediaMTX health now checks multiple valid Docker hostnames:
  - http://mediamtx:9997
  - http://rally-graphics-mediamtx:9997
  - MEDIAMTX_API_URL if configured
- MediaMTX is considered online if its API responds, even if no active paths are publishing yet.
- FFmpeg health checks multiple hostnames as well.
- Container/service health no longer treats disabled/non-API-checkable services as hard errors.
- Health summary counts active services separately from disabled services.
- docker-compose now sets MEDIAMTX_API_URL for app1 and app2.

After installing this build, restart the stack:

docker compose down
docker compose up -d --build

Then open Health. MediaMTX should show green if the container is running and its API port 9997 is reachable.
