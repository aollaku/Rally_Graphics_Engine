#!/bin/sh
set -eu
PUBLIC_HOST="${1:-${PUBLIC_IP:-localhost}}"
mkdir -p nginx/certs
TMP_CONF="$(mktemp)"
trap 'rm -f "$TMP_CONF"' EXIT

if printf '%s' "$PUBLIC_HOST" | grep -Eq '^[0-9a-fA-F:.]+$'; then
  ALT_ENTRY="IP.3 = $PUBLIC_HOST"
  CN="$PUBLIC_HOST"
else
  ALT_ENTRY="DNS.3 = $PUBLIC_HOST"
  CN="$PUBLIC_HOST"
fi

cat > "$TMP_CONF" <<CONF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req
[dn]
C = GB
ST = London
L = London
O = Rally Graphics
OU = Broadcast
CN = $CN
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
DNS.2 = rally-graphics.local
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
$ALT_ENTRY
CONF

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout nginx/certs/rally-graphics.key \
  -out nginx/certs/rally-graphics.crt \
  -config "$TMP_CONF"
chmod 600 nginx/certs/rally-graphics.key
printf 'Created SSL certificate for %s\n' "$PUBLIC_HOST"
