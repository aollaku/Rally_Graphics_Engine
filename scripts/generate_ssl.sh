#!/bin/sh
set -eu
mkdir -p nginx/certs
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout nginx/certs/rally-graphics.key \
  -out nginx/certs/rally-graphics.crt \
  -config nginx/openssl.cnf
chmod 600 nginx/certs/rally-graphics.key
printf 'Created SSL certificate:\n  nginx/certs/rally-graphics.crt\n  nginx/certs/rally-graphics.key\n'
