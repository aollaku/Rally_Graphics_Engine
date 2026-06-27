# Rally Graphics v33 - HA + SSL

This build keeps the v32 two-container high-availability setup and adds HTTPS/SSL through NGINX.

## Run

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

## URLs

HTTP is still available for local testing:

- PC controller: `http://localhost:8080/controller`
- Tablet: `http://localhost:8080/tablet`
- Output: `http://localhost:8080/output/live`

HTTPS/SSL is available on port `8443`:

- PC controller: `https://localhost:8443/controller`
- Tablet: `https://localhost:8443/tablet`
- Output: `https://localhost:8443/output/live`

The included certificate is self-signed, so the browser will show a warning the first time. Choose advanced/continue.

## Login

- Username: `superadmin`
- Password: `superadmin123`

## Replace the SSL certificate

For production, replace these files with your real certificate and key:

```text
nginx/certs/rally-graphics.crt
nginx/certs/rally-graphics.key
```

Then restart NGINX:

```bash
docker compose restart nginx
```

## Generate a fresh self-signed certificate

```bash
./scripts/generate_ssl.sh
docker compose restart nginx
```

## Services

- `nginx` - SSL reverse proxy and load balancer
- `app1` - Rally Graphics app instance 1
- `app2` - Rally Graphics app instance 2
- `postgres` - shared database
- `backup` - automatic database backups

## Failover test

```bash
docker compose stop app1
```

The site should remain available through `app2`.


## v34 Security Update
- Removed default admin credentials from the login page.
- Default admin account is still created by environment variables for first setup. Change the password after first login.


## v35 HTTPS-only change

HTTP access has been disabled. NGINX now exposes only HTTPS on port 8443.

Open:

- https://localhost:8443/controller
- https://localhost:8443/tablet
- https://localhost:8443/output/live

There is no `8080:80` mapping in docker-compose.yml anymore.

Run:

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```
