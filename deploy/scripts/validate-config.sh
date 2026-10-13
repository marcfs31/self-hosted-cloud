#!/usr/bin/env bash
# Validates the deployment configuration without a Tailscale node or a running stack. Needs docker
# only (Caddy runs from its image); run it from anywhere after changing deploy/:
#   deploy/scripts/validate-config.sh
#
# Checks, each of which must fail closed:
#   1. Caddyfile + CLOUD_TLS=internal on localhost              (docker-compose.local.yml)
#   2. Caddyfile + a ts.net name with throw-away cert files     (production path, /tls/cert.pem)
#   3. Caddyfile for a ts.net name WITHOUT cert files is refused (a missing cert must be loud)
#   4. both compose files render, and the base file mounts no tailscaled socket
#   5. a running Caddy serves a renewed certificate after `caddy reload --force` (what
#      renew-cert.sh does) and does NOT after a plain `caddy reload`
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
cid=""
cleanup() {
  [ -z "${cid}" ] || docker rm -f "${cid}" >/dev/null 2>&1 || true
  find "${tmp}" -delete
}
trap cleanup EXIT
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2}"

caddy_validate() { # <domain> <tls-env> <tls-dir>
  docker run --rm \
    -v "${here}/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "$3:/tls:ro" \
    -e "CLOUD_DOMAIN=$1" ${2:+-e "CLOUD_TLS=$2"} \
    "${CADDY_IMAGE}" caddy validate --config /etc/caddy/Caddyfile
}

new_cert() { # <dir>: a throw-away certificate for the test domain
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=cloud.tail0000.ts.net" \
    -addext "subjectAltName=DNS:cloud.tail0000.ts.net" \
    -keyout "$1/key.pem" -out "$1/cert.pem" 2>/dev/null
  chmod 0644 "$1/key.pem" # the container user must read it
}
mkdir "${tmp}/tls" "${tmp}/empty"
new_cert "${tmp}/tls"

echo "== 1. localhost, internal CA"
caddy_validate localhost internal "${tmp}/empty"
echo "== 2. ts.net name, certificate files"
caddy_validate cloud.tail0000.ts.net "" "${tmp}/tls"
echo "== 3. ts.net name without certificate files must be refused"
if caddy_validate cloud.tail0000.ts.net "" "${tmp}/empty"; then
  echo "FAIL: Caddy accepted a ts.net site without cert.pem/key.pem" >&2
  exit 1
fi
echo "refused, as intended"

echo "== 4. compose files"
export CLOUD_DOMAIN=cloud.tail0000.ts.net CLOUD_VERSION=0.0.0 CLOUD_IMAGE_PREFIX=ghcr.io/x/y \
  SECRET_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
base="$(docker compose -f "${here}/docker-compose.yml" config)"
if printf '%s' "${base}" | grep -q tailscaled; then
  echo "FAIL: docker-compose.yml mounts the tailscaled socket" >&2
  exit 1
fi
printf '%s' "${base}" | grep -q 'target: /tls' || { echo "FAIL: /tls is not mounted" >&2; exit 1; }
docker compose -f "${here}/docker-compose.yml" -f "${here}/docker-compose.local.yml" config >/dev/null
echo "ok"

echo "== 5. renewed certificate is only served after reload --force"
cid="$(docker run -d -p 127.0.0.1::443 \
  -v "${here}/Caddyfile:/etc/caddy/Caddyfile:ro" -v "${tmp}/tls:/tls:ro" \
  -e CLOUD_DOMAIN=cloud.tail0000.ts.net "${CADDY_IMAGE}")"
port="$(docker port "${cid}" 443/tcp | head -n 1 | sed 's/.*://')"
served() {
  echo | openssl s_client -connect "127.0.0.1:${port}" -servername cloud.tail0000.ts.net 2>/dev/null |
    openssl x509 -noout -serial
}
for _ in $(seq 1 30); do [ -n "$(served)" ] && break; sleep 1; done
before="$(served)"
[ -n "${before}" ] || { echo "FAIL: Caddy did not serve a certificate" >&2; exit 1; }
new_cert "${tmp}/tls"
reload() { docker exec "${cid}" caddy reload "$@" --config /etc/caddy/Caddyfile >/dev/null 2>&1; }
reload
sleep 1
[ "$(served)" = "${before}" ] || { echo "FAIL: a plain reload unexpectedly changed the certificate" >&2; exit 1; }
reload --force
sleep 1
[ "$(served)" != "${before}" ] || { echo "FAIL: reload --force kept the old certificate" >&2; exit 1; }
echo "plain reload kept ${before}; reload --force served $(served)"
echo "ok"
