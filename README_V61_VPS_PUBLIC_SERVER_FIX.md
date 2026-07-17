# v61 – VPS public-server deployment fix

Changes:
- Public HTTPS, HTTP output and MediaMTX HLS ports are configurable through `.env`.
- Controller and tablet no longer assume output is always on ports 8080/8888; they read runtime configuration from the server.
- SSL generation accepts the VPS IP address or DNS name and includes it in the certificate SAN.
- Added `scripts/vps-check.sh` to report container, port, health, proxy and firewall-related failures.
- Database password, session secret and default admin credentials can be supplied through `.env`.

## VPS deployment

```bash
cp .env.example .env
nano .env
./scripts/generate_ssl.sh 51.89.139.73
docker compose down --remove-orphans
docker compose up -d --build
docker compose ps
./scripts/vps-check.sh
```

For Ubuntu UFW:

```bash
sudo ufw allow 8443/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 8888/tcp
# Open ingest/control ports only when needed:
sudo ufw allow 1935/tcp
sudo ufw allow 8554/tcp
sudo ufw allow 8890/udp
sudo ufw allow 8889/tcp
sudo ufw allow 9997/tcp
sudo ufw reload
```

Also allow the same ports in the VPS provider firewall/security group. The controller is HTTPS at `https://SERVER_IP:8443/`; graphics output is HTTP at `http://SERVER_IP:8080/output/live`.
