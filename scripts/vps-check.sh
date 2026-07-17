#!/bin/sh
set -u
HTTPS_PORT="${PUBLIC_HTTPS_PORT:-8443}"
HTTP_PORT="${PUBLIC_HTTP_PORT:-8080}"
HLS_PORT="${PUBLIC_HLS_PORT:-8888}"

echo '=== Docker services ==='
docker compose ps || true
echo '\n=== Recent container logs ==='
docker compose logs --tail=80 nginx app1 app2 postgres || true
echo '\n=== Listening ports ==='
ss -lntup | grep -E ":(${HTTPS_PORT}|${HTTP_PORT}|${HLS_PORT}|1935|8554|8890|9997)\\b" || true
echo '\n=== Local HTTPS health ==='
curl -kfsS "https://127.0.0.1:${HTTPS_PORT}/healthz" || true
echo '\n\n=== Local HTTP output ==='
curl -fsSI "http://127.0.0.1:${HTTP_PORT}/output/live" || true
echo '\nFirewall ports required: TCP' "$HTTPS_PORT" "$HTTP_PORT" "$HLS_PORT" '1935 8554 8889 9997; UDP 8890 as needed.'
