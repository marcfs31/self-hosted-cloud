# Operations

Day-two runbook for the Pi: updates, rollback, backups, restore, monitoring. Setup of the
machine itself is in `pi-setup.md`. Everything below assumes the stack lives in `/opt/cloud`
and the data disk is mounted at `/data`.

| What                         | Where                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Compose project, `.env`      | `/opt/cloud/`                                                                                        |
| Host scripts                 | `/opt/cloud/scripts/` (`backup.sh`, `restore-test.sh`, `health-check.sh`, `renew-cert.sh`, `lib.sh`) |
| TLS certificate for Caddy    | `/opt/cloud/tls/{cert.pem,key.pem}` (written by `cloud-tls.service`, key mode 0600)                  |
| systemd units                | `/etc/systemd/system/cloud-*.{service,timer}`                                                        |
| Restic repository settings   | `/etc/cloud/restic.env`, `/etc/cloud/restic-offsite.env`                                             |
| Restic passwords             | `/etc/cloud/restic*.pass` (mode 0600, **copied off the Pi**)                                         |
| Live data                    | `/data/files`, `/data/db`, `/data/tmp`, `/data/thumbs`                                               |
| Database snapshot for backup | `/data/backups/cloud.sqlite` (written by the API, never the live DB)                                 |
| Status reports for dashboard | `/data/status/{backup,restore-test,health}.json` (written by the scripts)                            |

## Update

Releases are git tags `vX.Y.Z`. Tag push -> `images.yml` builds `linux/arm64` images and
pushes `ghcr.io/<owner>/self-hosted-cloud-{api,web}:X.Y.Z`. Wait for that workflow to be
green before updating.

```bash
cd /opt/cloud
sudo systemctl start cloud-backup.service        # fresh backup first; waits until done
sudo grep CLOUD_VERSION .env                     # note the current version (for rollback)
sudo sed -i 's/^CLOUD_VERSION=.*/CLOUD_VERSION=0.3.0/' .env
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps                           # all healthy
curl -fsS https://<host>.<tailnet>.ts.net/api/health
```

`up -d` recreates only the services whose image changed. The API applies pending database
migrations on start; because migrations are expand/contract (below), the previous version
keeps working against the migrated database.

Also update your off-Pi copy of `.env`.

## Rollback

Set `CLOUD_VERSION` back to the version you noted and recreate:

```bash
cd /opt/cloud
sudo sed -i 's/^CLOUD_VERSION=.*/CLOUD_VERSION=0.2.0/' .env
sudo docker compose pull
sudo docker compose up -d
```

This is safe without touching the database: release N+1 only **expands** the schema (new
columns and tables, nothing dropped or renamed), so release N still runs against it and
ignores what it does not know.

Rollback does **not** work across a release that completed a "contract" step (see Migration
policy): the old version would look for something that was dropped. For that case restore the
pre-update backup (Restore, below).

## Migration policy: expand / contract

Every schema change is split over three releases, so any single step can be rolled back by
one version:

| Release | Change                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------- |
| N       | **Expand.** Add the new column/table (nullable or with a default). Write to both old and new.  |
| N+1     | **Migrate.** Backfill data, read from the new one, stop using the old one. Old stays in place. |
| N+2     | **Contract.** Drop the old column/table. Only after N+1 has run in production for a while.     |

Rules: never rename or drop in the same release that stops using it; a migration must be
runnable on a database that already has a newer schema applied by a later release; every
migration is generated (`pnpm --filter @cloud/api db:generate`), never hand-written. From
1.0.0 a non-rollable migration is a MAJOR release and ships alone.

## Backups

What is backed up, nightly at 03:30 by `cloud-backup.timer`:

1. A consistent snapshot of the SQLite database: the script runs
   `node dist/backup-db.js /data/backups/cloud.sqlite` inside the API container (SQLite's
   online backup, safe while the API is running). The live `/data/db` files are never copied.
2. `restic backup` of `/data/files` and `/data/backups` (excluding `tmp`, `thumbs`, `db`).
   The database is snapshotted **before** the files, so a file uploaded in between is at
   worst an orphan, never a database row without its file.
3. `restic forget --prune` with `--keep-daily 7 --keep-weekly 4 --keep-monthly 12`.

Thumbnails and temp uploads are derived or transient and are not backed up.

### The database snapshot by hand (`backup-db`)

`node dist/backup-db.js <dest>` inside the API image takes the consistent copy of
`$DATA_DIR/db/cloud.sqlite` (`DATA_DIR` is already set in the container). It uses SQLite's
online backup, so it is safe while the API serves traffic, and only ever reads the live
files. The copy is built as `<dest>.tmp`, converted to a single self-contained file (no
`-wal`/`-shm`), checked with `PRAGMA integrity_check`, fsynced and renamed over `<dest>`, so a
reader sees the previous complete file or the new one, never a partial file. Exit code `0` =
success, `1` = failure with the reason on stderr (`DATA_DIR is not set`, `database not found`,
a write error, a failed integrity check), `2` = usage.

```bash
cd /opt/cloud
sudo docker compose exec -T api node dist/backup-db.js /data/backups/manual.sqlite
ls -l /data/backups/                                   # owned by 1000:1000
sqlite3 /data/backups/manual.sqlite 'PRAGMA integrity_check;'    # ok
```

From a source checkout the same command is `pnpm --filter @cloud/api build` followed by
`DATA_DIR=... pnpm --filter @cloud/api backup-db <dest>`.

### Repository 1: local USB disk

```bash
sudo lsblk -f                                       # find the USB disk, e.g. /dev/sdb1
sudo mkfs.ext4 -L cloud-backup /dev/sdb1            # only for a new, empty disk
sudo mkdir /mnt/backup && sudo chattr +i /mnt/backup
echo 'UUID=<uuid>  /mnt/backup  ext4  defaults,noatime,nofail  0  2' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount /mnt/backup

sudo install -d -m 0700 /etc/cloud
head -c 32 /dev/urandom | base64 | sudo tee /etc/cloud/restic.pass >/dev/null
sudo chmod 600 /etc/cloud/restic.pass
sudo tee /etc/cloud/restic.env >/dev/null <<'EOF'
RESTIC_REPOSITORY=/mnt/backup/restic
RESTIC_PASSWORD_FILE=/etc/cloud/restic.pass
RESTIC_REQUIRE_MOUNT=/mnt/backup
EOF
sudo chmod 600 /etc/cloud/restic.env
sudo sh -c 'set -a; . /etc/cloud/restic.env; restic init'
```

`RESTIC_REQUIRE_MOUNT` makes the backup fail instead of writing a repository onto the Pi's own
disk when the USB disk is unplugged.

### Repository 2: off-site

Any restic backend works. Backblaze B2 as an example (create a bucket and an application
key restricted to it first):

```bash
head -c 32 /dev/urandom | base64 | sudo tee /etc/cloud/restic-offsite.pass >/dev/null
sudo chmod 600 /etc/cloud/restic-offsite.pass
sudo tee /etc/cloud/restic-offsite.env >/dev/null <<'EOF'
RESTIC_REPOSITORY=b2:<bucket>:cloud
RESTIC_PASSWORD_FILE=/etc/cloud/restic-offsite.pass
B2_ACCOUNT_ID=<application key id>
B2_ACCOUNT_KEY=<application key>
EOF
sudo chmod 600 /etc/cloud/restic-offsite.env
sudo sh -c 'set -a; . /etc/cloud/restic-offsite.env; restic init'
```

Other backends: `s3:https://<endpoint>/<bucket>` (set `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`), `sftp:user@host:/path`, `rclone:remote:path`.

**Copy both password files and the off-site credentials to your password manager now.**
Without the repository password the backups are unreadable, and the Pi dying takes the
only other copy with it.

### Install the schedule

```bash
sudo cp /opt/cloud/systemd/cloud-*.service /opt/cloud/systemd/cloud-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-backup.timer cloud-restore-test.timer cloud-health.timer cloud-tls.timer
systemctl list-timers 'cloud-*'
```

`cloud-backup.service` runs `backup.sh /etc/cloud/restic.env /etc/cloud/restic-offsite.env`;
edit the `ExecStart` line (`sudo systemctl edit --full cloud-backup.service`) if you use a
different set of repositories. One database snapshot feeds all of them; if one repository
fails the others still run and the unit ends up failed.

First run, by hand, watching the output:

```bash
sudo systemctl start cloud-backup.service
journalctl -u cloud-backup.service -n 50 --no-pager
sudo sh -c 'set -a; . /etc/cloud/restic.env; restic snapshots'
```

### Restore test (monthly, and after any change to the backup)

`cloud-restore-test.timer` runs `restore-test.sh` on the 1st of each month at 05:00. It
restores the latest snapshot into `/data/tmp`, runs `PRAGMA integrity_check` on the restored
database (using `sqlite3` if installed, otherwise `better-sqlite3` from the API image),
compares the restored file count with the snapshot's listing, runs `restic check` on 5 % of
the data, prints a verdict and deletes the scratch directory.

```bash
sudo /opt/cloud/scripts/restore-test.sh                                  # primary repository
sudo /opt/cloud/scripts/restore-test.sh /etc/cloud/restic-offsite.env    # the off-site one
journalctl -u cloud-restore-test.service -n 40 --no-pager
```

A restore test needs free space equal to the data set under `/data/tmp`; the script checks
this first and says so. Set `RESTORE_TEST_BASE` to restore elsewhere.

## Restore: full disaster recovery

For a dead Pi, a dead data disk, or a corrupted database. You need: the restic repository
(USB disk or off-site), its password file contents, the off-Pi copy of `.env`.

1. **Rebuild the host.** New or repaired hardware: follow `pi-setup.md` sections 1-8
   (flash, base system, SSH, Docker, Tailscale, `/data`, firewall). For a replacement Pi,
   delete the old machine in the Tailscale admin console first so the new one can take the
   hostname and `<host>.<tailnet>.ts.net` stays the same.
2. **Stop anything that writes.** If the stack is already running:
   `cd /opt/cloud && sudo docker compose down`.
3. **Recreate the restic settings.** Put the password back at `/etc/cloud/restic.pass` (0600)
   and recreate `/etc/cloud/restic.env` as in Backups (a fresh machine has no repository to
   `init`: it already exists). For the USB disk, plug it in and mount it at `/mnt/backup`.
4. **Check the repository and pick a snapshot.**
   ```bash
   sudo sh -c 'set -a; . /etc/cloud/restic.env; restic snapshots --tag cloud'
   ```
   The newest one is the default. To go back in time, use its ID instead of `latest` below.
5. **Restore** files and the database snapshot into place (paths inside the snapshot are
   absolute, so the target is `/`):
   ```bash
   sudo sh -c 'set -a; . /etc/cloud/restic.env; restic restore latest --tag cloud --target /'
   ```
6. **Put the database where the API expects it.** The snapshot is a complete database; the
   live one was never backed up. Remove any stale leftovers first:
   ```bash
   sudo mkdir -p /data/db /data/tmp /data/thumbs /data/status
   sudo find /data/db -mindepth 1 -delete
   sudo cp /data/backups/cloud.sqlite /data/db/cloud.sqlite
   sudo chown -R 1000:1000 /data
   sudo chown root:root /data/status && sudo chmod 0755 /data/status
   ```
7. **Restore the deployment.** Copy `deploy/` to `/opt/cloud` (`pi-setup.md` section 9), recreate
   `.env` from your off-Pi copy. Use the version you were running, or the newest: a newer
   version migrates the restored database forward.
8. **Start and verify.**
   ```bash
   cd /opt/cloud
   sudo docker compose pull && sudo docker compose up -d
   sudo docker compose ps
   curl -fsS https://<host>.<tailnet>.ts.net/api/health
   ```
   Log in, open a few files from different users, check the file count against what you
   expect. Thumbnails regenerate on demand.
9. **Re-enable operations.** Re-install and enable the systemd units (Backups, "Install the
   schedule"), then run `cloud-backup.service` once and `restore-test.sh` once to prove the new
   machine protects the data again.

What can be lost: everything written between the snapshot's timestamp and the failure
(at most one day with the nightly schedule). Files in `/data/files` that have no row in the
restored database (uploaded after the database snapshot, before the files backup) are
orphans: unreachable through the app and safe to delete after you have looked at them.

## Monitoring

`cloud-health.timer` runs `health-check.sh` every 15 minutes (and 5 minutes after boot). Each
run logs one line per check to the journal:

| Check    | Fails when                                              | Unavailable when                                 |
| -------- | ------------------------------------------------------- | ------------------------------------------------ |
| Endpoint | `https://$CLOUD_DOMAIN/api/health` does not return 200  | `CLOUD_DOMAIN` cannot be determined              |
| Disk     | `/data` is not a mount point, or less than 10 % is free | `df` gives no answer                             |
| SMART    | `smartctl -H` reports a failing disk                    | `smartctl` missing, or the disk gives no verdict |

Exit codes: `0` all OK, `1` something failed, `2` nothing failed but something could not be
checked. Unknown is deliberately not "OK": a missing `smartctl` or a USB bridge that does not
pass SMART through shows up as a failed unit until you fix it (`apt install smartmontools`, or
set `SMART_ARGS="-d sat"` / `SMART_DEVICE=/dev/...` in a unit drop-in). Thresholds are
environment variables of the unit: `MIN_FREE_PERCENT`, `HEALTH_URL`, `HEALTH_CURL_ARGS`.

Every run of the three host scripts also writes a status report that the admin dashboard
shows (next section), so the same facts are visible without logging in to the Pi.

Look at it:

```bash
systemctl --failed                                   # any cloud-* unit here needs attention
systemctl list-timers 'cloud-*'                      # last and next run of each timer
journalctl -u cloud-health.service -n 20 --no-pager
journalctl -u cloud-backup.service --since yesterday --no-pager
cd /opt/cloud && sudo docker compose ps               # container health
```

`systemctl --failed` is the alert surface. To be told without logging in, add
`OnFailure=` to the three services pointing at a notifier you control (for example a
self-hosted ntfy topic); this repository deliberately ships none, so no third party
learns about your Pi.

## Admin dashboard (system status)

`GET /api/admin/system` (admins only; everyone else gets `404`) returns the data for the
dashboard page. Two kinds of values:

**Live, read by the API container on each request:** CPU core count and load averages
(1/5/15 min), CPU temperature, memory (total and available), uptime of the API process,
free and total bytes of the data disk, the API version.

- Temperature comes from `/sys/class/thermal/thermal_zone0/temp`; if the container cannot read
  it the value is `null` ("unknown", never 0 degrees).
- Available memory is `MemAvailable` from `/proc/meminfo` (what can be allocated without
  swapping), falling back to the free memory reported by Node.
- Storage is `statfs` on the data directory; `null` if that call fails.

**Host checks, written by the systemd timers' scripts** as JSON files in `/data/status/`
(readable by the API through the `/data` mount):

| Check          | File                             | Written by        | Stale after |
| -------------- | -------------------------------- | ----------------- | ----------- |
| Backup         | `/data/status/backup.json`       | `backup.sh`       | 36 hours    |
| Restore test   | `/data/status/restore-test.json` | `restore-test.sh` | 40 days     |
| Health (SMART) | `/data/status/health.json`       | `health-check.sh` | 1 hour      |

The thresholds live in `packages/shared/src/system.ts` (`STALE_AFTER_HOURS`): the nightly backup
gets one missed night of slack, the monthly restore test a few days of slack over the
monthly schedule, and the health check (every 15 minutes) four missed runs.

Each check is in exactly one of four states:

| State     | Meaning                                                                                                              | What to do                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ok`      | The last run succeeded and is younger than the stale threshold.                                                      | Nothing.                                                                 |
| `failing` | The last run reported a problem (`ok: false`). A failing report stays `failing` however old it is.                   | Read the unit's journal (`journalctl -u cloud-<name>.service`).          |
| `stale`   | The last run succeeded but is older than the threshold: the timer stopped, the Pi was off, or the script cannot run. | `systemctl list-timers 'cloud-*'`, `systemctl --failed`, run it by hand. |
| `unknown` | There is no report, or it is unreadable, not valid JSON, malformed, or dated more than 5 minutes in the future.      | Normal until the first run after setup; otherwise check `/data/status`.  |

`stale` and `unknown` are never shown as healthy. A check that could not run is also reported as
not ok: for example `health.json` has `"ok": false` and `"smart": "unavailable"` when
`smartctl` is missing (the unit exits 2, see Monitoring).

A report is a single small file: `{"ok": true, "checkedAt": "2026-10-13T03:31:07Z", "facts": {...}}`.
The scripts write it atomically (temp file in the same directory, then `mv`) with mode `0644`,
as root. `/data/status` is owned by root (`pi-setup.md`) so that the API, which runs as uid 1000,
can read the reports but not forge them. The facts, all strings:

| File                | Fact                 | Values                                                                |
| ------------------- | -------------------- | --------------------------------------------------------------------- |
| `health.json`       | `endpoint`           | HTTP status of the health URL (`000` = no answer), or `unavailable`   |
|                     | `freePercent`        | free space on `/data` in percent, or `unavailable`                    |
|                     | `smart`              | `PASSED`, `FAILED` or `unavailable`                                   |
| `backup.json`       | `repositories`       | number of restic repositories configured for the run                  |
|                     | `failedRepositories` | how many failed, or `unavailable` if none was attempted               |
|                     | `snapshot`           | `ok`, `failed` or `not-run` (the database snapshot)                   |
| `restore-test.json` | `integrity`          | `ok`, `failed` or `not-run` (`PRAGMA integrity_check` on the restore) |
|                     | `files`              | `<restored>/<listed>` file counts, or `not-run`                       |

Scripts write their report on every exit path, including early failures (restic not installed,
`/data` not mounted), so a broken setup shows up as `failing` rather than as silence. If the
report itself cannot be written (for example `/data/status` is missing), the script exits
non-zero so the unit shows as failed.

Look at the raw reports on the Pi:

```bash
sudo sh -c 'for f in /data/status/*.json; do echo "$f: $(cat "$f")"; done'
```

## WebDAV (mount the cloud as a drive)

`https://<host>/dav/` is each user's root folder over WebDAV, so Finder, Windows Explorer and
phone file apps can browse, open and save files like on a network drive. It is served by the API
(Caddy routes `/dav` and `/dav/*` to `api:4000` with no body size limit and no compression) and
goes through the same rules as the web UI: the same quota, the trash (a delete over WebDAV is
recoverable for 30 days), version history (saving over a file adds a version), the activity log
(shown with `via: webdav`) and the change feed.

**Sign-in.** HTTP Basic: the user name is the account **email**, the password is an **app
password** (Security, App passwords, "Create an app password"). The account password and the
browser session cookie are never accepted on `/dav`. Make one app password per device so it can
be revoked alone; a revoked one stops working at once. Five wrong attempts from one address lock
that address out of `/dav` for 15 minutes (the same rule as sign-in). Always use the `https://`
address: Basic sends the app password with every request.

### macOS Finder

1. Finder, Go, Connect to Server (Cmd-K).
2. Enter `https://<host>/dav/` and click Connect.
3. Choose "Registered User", enter the email and the app password, click Connect.

The drive appears in the sidebar under Locations. Finder writes `.DS_Store` and `._*` files
into folders it opens; they are ordinary files here.

### Windows

Use Map network drive (This PC, three-dot menu, Map network drive), folder
`https://<host>/dav/` (keep the trailing slash), tick "Connect using different credentials",
then the email and the app password. Windows needs HTTPS with a certificate it trusts; a
Tailscale-issued certificate is fine.

Two Windows limits to know:

- **The WebClient service must be running** (Services, "WebClient", start type Automatic). It is
  not installed on Windows Server unless the "WebDAV Redirector" feature is added.
- **Files larger than 50 MB fail** ("The file size exceeds the limit allowed and cannot be
  saved") because the WebClient caps downloads at 50 000 000 bytes by default. Raise it
  from an elevated prompt, then restart the service:

  ```bat
  reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f
  net stop WebClient && net start WebClient
  ```

  `4294967295` (about 4 GB) is the highest value the setting accepts; bigger files should be
  uploaded through the web UI or the CLI, which resume after an interruption. Windows also
  uploads a file in one request, so a flaky connection restarts the file.

### iPhone and iPad (Files app)

Files, "..." menu, Connect to Server, `https://<host>/dav/`, Registered User, email and app
password. Third-party apps (Documents, FE File Explorer, Infuse for video) also accept a WebDAV
URL with the same credentials.

### Android

Android has no built-in WebDAV client. Use an app that does: Solid Explorer, CX File Explorer or
FolderSync (set the account type to WebDAV, server `<host>`, path `/dav/`, port 443, SSL on, user
= email, password = app password). Files-based apps such as Total Commander work the same way.

### Limits and behaviour

- **Locks are advisory and per process.** LOCK/UNLOCK (class 2, exclusive write, up to one hour,
  refreshable) are kept in the API's memory: they only constrain other WebDAV requests, not the
  web UI, the API or tus uploads, and a restart of the API forgets them (clients re-lock). The
  `If` header is checked for lock tokens only; ETag conditions in it are ignored.
- **Depth: infinity PROPFIND is refused** (403, `propfind-finite-depth`); clients list one folder
  at a time.
- **Names** follow the web UI's rules: no `/` or `\`, no control characters, at most 255
  characters, no leading or trailing spaces; names are stored in Unicode NFC. Names are
  case-sensitive.
- **Quota:** a write that does not fit answers `507 Insufficient Storage`; free space is
  reported to clients as `quota-available-bytes`.
- **Not supported:** custom (dead) properties (PROPPATCH answers 403 per property, which Finder
  tolerates), shared locks, partial PUT, and versioning methods.
- **Temp files:** uploads stream to `/data/tmp/dav` and are moved into place once complete; the
  hourly sweep removes leftovers of a crash.
- **Troubleshooting:** `401` repeatedly means wrong email or a revoked app password; `429` means
  the address is locked out for 15 minutes; `502` on a rename/copy means the client sent a
  `Destination` host that is not this server (check the Host header Caddy forwards);
  `curl -u '<email>:<app password>' -X PROPFIND -H 'Depth: 1' https://<host>/dav/` is the
  quickest test from the Pi.

## TLS certificate

The `*.ts.net` certificate is not Caddy's business. `cloud-tls.timer` runs `cloud-tls.service`
daily (randomised by up to an hour), which runs `/opt/cloud/scripts/renew-cert.sh` as root on the
host:

```bash
tailscale cert --cert-file /opt/cloud/tls/cert.pem --key-file /opt/cloud/tls/key.pem <host>.<tailnet>.ts.net
docker compose exec -T caddy caddy reload --force --config /etc/caddy/Caddyfile   # only if Caddy is running
```

`tailscale cert` returns the cached certificate until it is close to expiry, so the daily run is
cheap. The reload needs `--force`: the Caddyfile text did not change, and a plain `caddy reload`
then does nothing and keeps serving the old certificate. Caddy mounts `/opt/cloud/tls` read-only at `/tls` and the Caddyfile says
`tls /tls/cert.pem /tls/key.pem`; the `tailscaled` socket is **not** mounted, because a container
that can reach it controls the tailnet node.

```bash
systemctl list-timers cloud-tls.timer
sudo systemctl start cloud-tls.service && journalctl -u cloud-tls.service -n 20 --no-pager
sudo openssl x509 -in /opt/cloud/tls/cert.pem -noout -enddate
```

If the certificate expires (the timer stopped, the Pi was off for weeks) browsers show a
certificate error; run the service by hand. After a replacement Pi, run `renew-cert.sh` before the
first `docker compose up` (Caddy refuses to start without the files).

## Local smoke test (workstation)

`docker-compose.local.yml` swaps the Tailscale certificate for Caddy's internal CA
(`CLOUD_TLS=internal`), for trying a build on a laptop:

```bash
cd deploy
cp .env.example .env     # CLOUD_DOMAIN=localhost, CLOUD_VERSION=local, CLOUD_IMAGE_PREFIX=cloud
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
curl -k https://localhost/api/health
```

The base file publishes 80/443 and mounts `/data`; use a third `-f` file to change ports or the
data volume when the workstation already uses them. `deploy/scripts/validate-config.sh` checks
the Caddyfile (localhost, a `.ts.net` name with throw-away certificate files, and the refusal when
the files are missing) and both compose files with nothing but Docker.

## Logs and log rotation

Container logs use Docker's `json-file` driver, rotated by the compose file: 10 MB per file,
3 files, per service (about 30 MB each, 90 MB total). Read them with
`sudo docker compose logs --since 1h api`. Host logs go to journald; cap them in
`/etc/systemd/journald.conf` with `SystemMaxUse=500M` if the disk is small. Restic and the
scripts log to the journal through their systemd units.

## Housekeeping

- Monthly: `sudo apt update && sudo apt upgrade` (covers Docker and Tailscale), then
  `sudo docker image prune -f` to drop old images (keep the previous version for rollback).
- Check `systemctl --failed` and `df -h /data /mnt/backup` after every update.
- Once a quarter: swap or rotate the off-site/USB disks, run the restore test against the
  off-site repository, and confirm the password files still exist in the password manager.
