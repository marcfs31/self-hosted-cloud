#!/usr/bin/env bash
# Fetches (or renews) the Tailscale certificate for CLOUD_DOMAIN into /opt/cloud/tls and tells
# Caddy to reload it. Run daily by cloud-tls.service; run it by hand once before the first
# `docker compose up` (Caddy refuses to start without the files).
#
# Why the host does this: Caddy used to reach the host's tailscaled through its socket, which gives
# the container control of the tailnet node. Now Caddy only reads two files, read-only.
#
# Env (all optional):
#   CLOUD_ENV_FILE   default /opt/cloud/.env   (CLOUD_DOMAIN is read from it, never sourced)
#   CLOUD_DOMAIN     overrides the value in the env file
#   CLOUD_TLS_DIR    default /opt/cloud/tls     (cert.pem 0644, key.pem 0600, directory 0755)
#   CLOUD_DIR        default /opt/cloud         (the compose project, for `docker compose exec`)
#
# Exit codes: 0 certificate in place (and Caddy reloaded when it is running);
#             1 the certificate could not be fetched or Caddy refused the reload.
set -euo pipefail

ENV_FILE="${CLOUD_ENV_FILE:-/opt/cloud/.env}"
TLS_DIR="${CLOUD_TLS_DIR:-/opt/cloud/tls}"
CLOUD_DIR="${CLOUD_DIR:-/opt/cloud}"

domain="${CLOUD_DOMAIN:-}"
if [ -z "${domain}" ] && [ -r "${ENV_FILE}" ]; then
  # Read the one value; never source the file.
  domain="$(sed -n 's/^CLOUD_DOMAIN=//p' "${ENV_FILE}" | tail -n 1)"
fi
case "${domain}" in
  *.ts.net) ;;
  *)
    printf 'renew-cert: CLOUD_DOMAIN must be a <host>.<tailnet>.ts.net name, got: "%s" (set it in %s)\n' \
      "${domain}" "${ENV_FILE}" >&2
    exit 1
    ;;
esac

install -d -m 0755 "${TLS_DIR}"
# tailscale writes the key with 0600 and renews only when the certificate is close to expiry.
tailscale cert --cert-file "${TLS_DIR}/cert.pem" --key-file "${TLS_DIR}/key.pem" "${domain}"
chmod 0644 "${TLS_DIR}/cert.pem"
chmod 0600 "${TLS_DIR}/key.pem"
printf 'renew-cert: certificate for %s is in %s\n' "${domain}" "${TLS_DIR}"

cd "${CLOUD_DIR}"
if docker compose ps --status running --services | grep -qx caddy; then
  # --force: the Caddyfile text is unchanged, and without it Caddy skips the reload and keeps
  # serving the old certificate (verified: the served serial only changes with --force).
  docker compose exec -T caddy caddy reload --force --config /etc/caddy/Caddyfile
  printf 'renew-cert: caddy reloaded\n'
else
  printf 'renew-cert: caddy is not running; it reads the files when it starts\n'
fi
