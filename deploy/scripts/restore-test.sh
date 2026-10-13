#!/usr/bin/env bash
# Monthly restore test: restore the latest restic snapshot into a scratch directory and prove
# it is usable. A backup that was never restored is a hope, not a backup.
#
#   restore-test.sh [ENV_FILE]     default ENV_FILE: /etc/cloud/restic.env
#
# Checks (any failure => verdict FAIL, exit 1):
#   1. enough free space for the restore
#   2. restic check on the repository (structure + a random 5 % of the data packs)
#   3. restic restore of the latest snapshot completes
#   4. PRAGMA integrity_check on the restored database returns "ok"
#   5. restored file count equals the file count the snapshot lists
# The live file count is printed for information only: uploads and deletes since the
# snapshot legitimately make it differ.
#
# Env: RESTORE_TEST_BASE (scratch parent, default /data/tmp), RESTORE_TEST_CHECK_SUBSET
#      (restic check --read-data-subset, default 5%), CLOUD_STATUS_DIR (default $DATA_DIR/status).
#
# Every run, successful or not, ends by writing restore-test.json for the admin dashboard
# (see lib.sh). It is ok only when the verdict is PASS (exit 0). Facts:
#   integrity   ok | failed | not-run      (PRAGMA integrity_check of the restored database)
#   files       <restored>/<listed>, or "not-run"   (restored file count / snapshot listing)
# If the report cannot be written the script exits non-zero even though the test ran.
set -euo pipefail

# shellcheck source=/dev/null
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ENV_FILE="${1:-/etc/cloud/restic.env}"
COMPOSE_FILE="${CLOUD_COMPOSE_FILE:-/opt/cloud/docker-compose.yml}"
DATA_DIR="${CLOUD_DATA_DIR:-/data}"
STATUS_DIR="${CLOUD_STATUS_DIR:-${DATA_DIR}/status}"
BASE="${RESTORE_TEST_BASE:-${DATA_DIR}/tmp}"
SUBSET="${RESTORE_TEST_CHECK_SUBSET:-5%}"

log() { printf '%s restore-test: %s\n' "$(date -Is)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

work=""
fact_integrity="not-run"
fact_files="not-run"

# EXIT trap: removes the scratch directory, then publishes the report on every exit path
# (PASS, FAIL, die, or a command killed by set -e).
on_exit() {
  local rc=$?
  trap - EXIT
  [ -z "${work}" ] || find "${work}" -delete
  local ok=false
  [ "${rc}" -eq 0 ] && ok=true
  if ! write_report "${STATUS_DIR}/restore-test.json" "${ok}" \
    "integrity=${fact_integrity}" "files=${fact_files}"; then
    log "ERROR: could not write the dashboard report" >&2
    rc=1
  fi
  exit "${rc}"
}
trap on_exit EXIT

command -v restic >/dev/null || die "restic is not installed"
[ -r "${ENV_FILE}" ] || die "cannot read env file: ${ENV_FILE}"
[ -d "${BASE}" ] || die "scratch parent does not exist: ${BASE}"

set -a
# shellcheck source=/dev/null
. "${ENV_FILE}"
set +a
[ -n "${RESTIC_REPOSITORY:-}" ] || die "RESTIC_REPOSITORY unset in ${ENV_FILE}"
[ -r "${RESTIC_PASSWORD_FILE:-/nonexistent}" ] || die "RESTIC_PASSWORD_FILE unset or unreadable in ${ENV_FILE}"
if [ -n "${RESTIC_REQUIRE_MOUNT:-}" ]; then
  mountpoint -q "${RESTIC_REQUIRE_MOUNT}" || die "${RESTIC_REQUIRE_MOUNT} is not mounted"
fi

work="$(mktemp -d "${BASE}/restore-test.XXXXXX")"
case "${work}" in
  "${BASE}"/restore-test.*) ;;
  *) die "unexpected scratch path: ${work}" ;;
esac

failures=()
fail() { log "FAIL: $*" >&2; failures+=("$*"); }

log "repository: ${RESTIC_REPOSITORY}"

# --- 1. space
stats="$(restic stats latest --tag cloud --mode restore-size --json)" || die "no snapshot found (restic stats failed)"
need="$(printf '%s' "${stats}" | sed -n 's/.*"total_size":\([0-9]*\).*/\1/p')"
[ -n "${need}" ] || die "could not read restore size from: ${stats}"
free="$(df -PB1 "${work}" | awk 'NR==2 {print $4}')"
log "restore needs ${need} bytes, ${free} free in ${BASE}"
if [ "${free}" -lt $((need + need / 10)) ]; then
  die "not enough free space in ${BASE} for the restore (need ${need} + 10 %, have ${free})"
fi

# --- 2. repository check
if [ -n "${SUBSET}" ] && [ "${SUBSET}" != "0" ]; then
  log "restic check --read-data-subset=${SUBSET}"
  restic check --read-data-subset="${SUBSET}" || fail "restic check reported errors"
fi

# --- 3. restore
log "restoring latest snapshot to ${work}"
if restic restore latest --tag cloud --target "${work}"; then
  :
else
  fail "restic restore failed"
fi

# --- 4. database integrity
db_dir="${work}${DATA_DIR}/backups"
db="${db_dir}/cloud.sqlite"
if [ ! -s "${db}" ]; then
  fact_integrity="failed"
  fail "restored database snapshot missing or empty: ${db}"
else
  verdict=""
  if command -v sqlite3 >/dev/null; then
    verdict="$(sqlite3 "${db}" 'PRAGMA integrity_check;' 2>&1)" || verdict="sqlite3 failed: ${verdict}"
  else
    image="$(docker compose -f "${COMPOSE_FILE}" config --images 2>/dev/null | grep -- '-api:' | head -n 1 || true)"
    if [ -z "${image}" ]; then
      verdict="cannot verify: sqlite3 is not installed and the api image is unknown"
    else
      js='const D=require("better-sqlite3");const d=new D("/restore/cloud.sqlite",{fileMustExist:true});console.log(d.pragma("integrity_check").map(r=>r.integrity_check).join("\n"));'
      verdict="$(docker run --rm --user 0 --network none --entrypoint node \
        -v "${db_dir}:/restore" "${image}" -e "${js}" 2>&1)" || verdict="node failed: ${verdict}"
    fi
  fi
  log "PRAGMA integrity_check: ${verdict}"
  if [ "${verdict}" = "ok" ]; then
    fact_integrity="ok"
  else
    fact_integrity="failed"
    fail "database integrity_check: ${verdict}"
  fi
fi

# --- 5. file counts
listing="$(restic ls latest --tag cloud --recursive --json "${DATA_DIR}/files")" || die "restic ls failed; cannot compare file counts"
listed="$(printf '%s\n' "${listing}" | grep -c '"type":"file"' || true)"
restored=0
if [ -d "${work}${DATA_DIR}/files" ]; then
  restored="$(find "${work}${DATA_DIR}/files" -type f | wc -l | tr -d ' ')"
fi
live="$(find "${DATA_DIR}/files" -type f 2>/dev/null | wc -l | tr -d ' ')"
log "files: snapshot lists ${listed}, restored ${restored}, live now ${live} (informational)"
fact_files="${restored}/${listed}"
[ "${restored}" -eq "${listed}" ] || fail "restored file count ${restored} != snapshot listing ${listed}"

# --- verdict
if [ "${#failures[@]}" -gt 0 ]; then
  log "VERDICT: FAIL (${#failures[@]} problem(s))" >&2
  for f in "${failures[@]}"; do log "  - ${f}" >&2; done
  exit 1
fi
log "VERDICT: PASS"
