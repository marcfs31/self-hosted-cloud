#!/usr/bin/env bash
# Health check, run every 15 minutes by cloud-health.timer. Output goes to the journal.
#
# Exit codes (unknown is a state, not success):
#   0  every check passed
#   1  at least one check FAILED
#   2  nothing failed, but at least one check could not be performed (UNAVAILABLE),
#      e.g. smartctl missing or the disk does not report SMART through its USB bridge
#
# Env (all optional):
#   HEALTH_URL          default https://$CLOUD_DOMAIN/api/health ($CLOUD_DOMAIN from /opt/cloud/.env)
#   HEALTH_CURL_ARGS    extra curl arguments, e.g. "-k" for a localhost certificate
#   MIN_FREE_PERCENT    free-space threshold on the data disk, default 10
#   SMART_DEVICE        disk to query, default: the disk backing /data
#   SMART_ARGS          extra smartctl arguments, e.g. "-d sat" for some USB SSDs
set -uo pipefail

DATA_DIR="${CLOUD_DATA_DIR:-/data}"
ENV_FILE="${CLOUD_ENV_FILE:-/opt/cloud/.env}"
MIN_FREE_PERCENT="${MIN_FREE_PERCENT:-10}"

failed=0
unavailable=0
ok()   { printf 'OK          %s\n' "$*"; }
bad()  { printf 'FAIL        %s\n' "$*"; failed=$((failed + 1)); }
unk()  { printf 'UNAVAILABLE %s\n' "$*"; unavailable=$((unavailable + 1)); }

# --- endpoint
domain=""
if [ -z "${HEALTH_URL:-}" ] && [ -r "${ENV_FILE}" ]; then
  # Read the one value; never source the file.
  domain="$(sed -n 's/^CLOUD_DOMAIN=//p' "${ENV_FILE}" | tail -n 1)"
fi
url="${HEALTH_URL:-https://${domain}/api/health}"
if [ -z "${HEALTH_URL:-}" ] && [ -z "${domain}" ]; then
  unk "endpoint: no HEALTH_URL and no CLOUD_DOMAIN in ${ENV_FILE}"
else
  # shellcheck disable=SC2086
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 ${HEALTH_CURL_ARGS:-} "${url}" 2>/dev/null)" || code="000"
  if [ "${code}" = "200" ]; then
    ok "endpoint ${url} -> 200"
  else
    bad "endpoint ${url} -> ${code} (expected 200)"
  fi
fi

# --- data disk mounted and free space
if ! mountpoint -q "${DATA_DIR}"; then
  bad "${DATA_DIR} is not a mount point (data disk missing?)"
else
  used="$(df -P "${DATA_DIR}" | awk 'NR==2 {gsub("%","",$5); print $5}')"
  if [ -z "${used}" ]; then
    unk "disk space: df gave no answer for ${DATA_DIR}"
  else
    free=$((100 - used))
    if [ "${free}" -lt "${MIN_FREE_PERCENT}" ]; then
      bad "disk space: ${free}% free on ${DATA_DIR} (threshold ${MIN_FREE_PERCENT}%)"
    else
      ok "disk space: ${free}% free on ${DATA_DIR} (threshold ${MIN_FREE_PERCENT}%)"
    fi
  fi
fi

# --- SMART
if ! command -v smartctl >/dev/null; then
  unk "smart: smartctl is not installed (apt install smartmontools)"
else
  dev="${SMART_DEVICE:-}"
  if [ -z "${dev}" ]; then
    src="$(findmnt -no SOURCE "${DATA_DIR}" 2>/dev/null || true)"
    parent="$(lsblk -no PKNAME "${src}" 2>/dev/null | head -n 1 || true)"
    if [ -n "${parent}" ]; then dev="/dev/${parent}"; else dev="${src}"; fi
  fi
  if [ -z "${dev}" ]; then
    unk "smart: cannot determine the disk backing ${DATA_DIR}; set SMART_DEVICE"
  else
    # shellcheck disable=SC2086
    out="$(smartctl -H ${SMART_ARGS:-} "${dev}" 2>&1)"
    rc=$?
    if printf '%s' "${out}" | grep -Eq 'overall-health self-assessment test result: PASSED|SMART Health Status: OK'; then
      ok "smart ${dev}: PASSED"
    elif printf '%s' "${out}" | grep -Eq 'FAILED'; then
      bad "smart ${dev}: health check FAILED (smartctl exit ${rc})"
    else
      unk "smart ${dev}: no verdict (smartctl exit ${rc}): $(printf '%s' "${out}" | tail -n 1)"
    fi
  fi
fi

if [ "${failed}" -gt 0 ]; then
  echo "RESULT: FAIL (${failed} failed, ${unavailable} unavailable)"
  exit 1
elif [ "${unavailable}" -gt 0 ]; then
  echo "RESULT: UNKNOWN (${unavailable} check(s) could not run)"
  exit 2
fi
echo "RESULT: OK"
