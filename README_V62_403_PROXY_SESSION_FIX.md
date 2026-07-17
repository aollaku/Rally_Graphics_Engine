# Rally Graphics v62 — VPS 403 / proxy session fix

This release removes false 403 responses caused by the reverse proxy:

- Unknown HTTP control paths now redirect to HTTPS instead of returning 403.
- `/output` and `/output/live` can also load over HTTPS as a compatibility fallback.
- Express now trusts the Nginx proxy.
- Login session cookies use secure auto-detection behind HTTPS.

## Upgrade

```bash
docker compose down
docker compose build --no-cache app1 ffmpeg-engine
docker compose up -d --force-recreate
docker compose ps
docker compose logs --tail=150 nginx app1 app2
```

Test:

```bash
curl -kI https://127.0.0.1:8443/login
curl -kI https://127.0.0.1:8443/output/live
curl -I http://127.0.0.1:8080/output/live
curl -I http://127.0.0.1:8080/controller
```

The final command should return a 308 redirect to HTTPS, not 403.
