# Rally Graphics v37 - Stage Times Two-Line Title

This build keeps the same controller, tablet, output routing and graphics layout as v36.

Only change:
- Stage Times title is split into two lines:
  - `TIMES FOR STAGE X :`
  - `STAGE NAME`

Controller remains HTTPS only and output remains HTTP only:
- Controller: https://localhost:8443/controller
- Tablet: https://localhost:8443/tablet
- Output: http://localhost:8080/output/live

Run:
```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```
