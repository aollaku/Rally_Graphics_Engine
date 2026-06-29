Logo output fix
===============

Fixed broken logo images on HTTP /preview and /output.

Cause:
The uploaded PNG logo was available through the HTTPS controller route, but the HTTP output NGINX server did not expose /uploads/logos/, so output pages showed the browser broken-image icon.

Changes:
- HTTP NGINX now allows /uploads/logos/ for preview/output pages.
- Docker Compose now mounts a shared logos_data volume into app1 and app2 so uploaded logos are available from both redundant app containers.
- Transparency is still preserved because PNG files are served directly from the upload library.

If running with Docker Compose, rebuild/recreate once:
  docker compose down
  docker compose up -d --build

If running with npm start directly, this fix is harmless; Express already serves /uploads/logos/.
