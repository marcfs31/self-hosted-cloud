#!/usr/bin/env bash
# Nightly backup: consistent SQLite snapshot, then restic of the files and the snapshot.
#
#   backup.sh [ENV_FILE...]        default ENV_FILE: /etc/cloud/restic.env
#
# Each ENV_FILE describes one restic repository and must set RESTIC_REPOSITORY and
# RESTIC_PASSWORD_FILE (plus any backend credentials, e.g. B2_ACCOUNT_ID). Passing several
# files backs up to several repositories (local USB disk + off-site) from ONE database
# snapshot. A failing repository does not stop the others, but the script then exits
# non-zero so the systemd unit shows as failed.
#
# Optional in an ENV_FILE: RESTIC_REQUIRE_MOUNT=/mnt/backup  -> fail unless that path is a
# mount point (a repository written to an unmounted USB disk silently fills the rootfs).
#
# The live database under /data/db is never copied: only the snapshot taken by the API
# (online backup API) in /data/backups is. Order matters: database first, files second, so
# a file uploaded in between is at worst an orphan, never a database row without its blob.
set -euo pipefail

COMPOSE_FILE="${CLOUD_COMPOSE_FILE:-/opt/cloud/docker-compose.yml}"
DATA_DIR="${CLOUD_DATA_DIR:-/data}"
SNAPSHOT="${DATA_DIR}/backups/cloud.sqlite"
# Path of the same file inside the api container (/data is mounted there).
SNAPSHOT_IN_CONTAINER="/data/backups/cloud.sqlite"

log() { printf '%s backup: %s\n' "$(date -Is)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

command -v restic >/dev/null || die "restic is not installed"
command -v docker >/dev/null || die "docker is not installed"
[ -d "${DATA_DIR}/files" ] || die "${DATA_DIR}/files does not exist (is the data disk mounted?)"
mountpoint -q "${DATA_DIR}" || die "${DATA_DIR} is not a mount point"

env_files=("$@")
[ "${#env_files[@]}" -gt 0 ] || env_files=(/etc/cloud/restic.env)
for f in "${env_files[@]}"; do
  [ -r "$f" ] || die "cannot read env file: $f"
done

log "database snapshot"
rm -f -- "${SNAPSHOT}"
docker compose -f "${COMPOSE_FILE}" exec -T api node dist/backup-db.js "${SNAPSHOT_IN_CONTAINER}"
[ -s "${SNAPSHOT}" ] || die "snapshot missing or empty after backup-db.js: ${SNAPSHOT}"

# Called as `if ( backup_one ... )`, where `set -e` is inactive: every command that can
# fail carries its own `|| return 1`.
backup_one() {
  local env_file="$1"
  set -a
  # shellcheck source=/dev/null
  . "${env_file}" || return 1
  set +a
  [ -n "${RESTIC_REPOSITORY:-}" ] || { log "ERROR: RESTIC_REPOSITORY unset in ${env_file}" >&2; return 1; }
  [ -n "${RESTIC_PASSWORD_FILE:-}" ] || { log "ERROR: RESTIC_PASSWORD_FILE unset in ${env_file}" >&2; return 1; }
  [ -r "${RESTIC_PASSWORD_FILE}" ] || { log "ERROR: cannot read ${RESTIC_PASSWORD_FILE}" >&2; return 1; }
  if [ -n "${RESTIC_REQUIRE_MOUNT:-}" ] && ! mountpoint -q "${RESTIC_REQUIRE_MOUNT}"; then
    log "ERROR: ${RESTIC_REQUIRE_MOUNT} is not mounted" >&2
    return 1
  fi
  log "restic backup -> ${RESTIC_REPOSITORY}"
  restic backup \
    --tag cloud \
    --exclude "${DATA_DIR}/tmp" \
    --exclude "${DATA_DIR}/thumbs" \
    --exclude "${DATA_DIR}/db" \
    "${DATA_DIR}/files" "${DATA_DIR}/backups" || return 1
  log "restic forget --prune -> ${RESTIC_REPOSITORY}"
  restic forget --prune --tag cloud --keep-daily 7 --keep-weekly 4 --keep-monthly 12 || return 1
}

failed=0
for f in "${env_files[@]}"; do
  # Subshell: each repository's variables must not leak into the next one.
  if ( backup_one "$f" ); then
    log "OK ${f}"
  else
    log "FAILED ${f}" >&2
    failed=$((failed + 1))
  fi
done

[ "${failed}" -eq 0 ] || die "${failed} of ${#env_files[@]} repositories failed"
log "done"
