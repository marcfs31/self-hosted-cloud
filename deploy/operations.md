# Operations

Day-two runbook for the Pi: updates, rollback, backups, restore, monitoring. Setup of the
machine itself is in `pi-setup.md`. Everything below assumes the stack lives in `/opt/cloud`
and the data disk is mounted at `/data`.

| What                         | Where                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| Compose project, `.env`      | `/opt/cloud/`                                                             |
| Host scripts                 | `/opt/cloud/scripts/` (`backup.sh`, `restore-test.sh`, `health-check.sh`) |
| systemd units                | `/etc/systemd/system/cloud-*.{service,timer}`                             |
| Restic repository settings   | `/etc/cloud/restic.env`, `/etc/cloud/restic-offsite.env`                  |
| Restic passwords             | `/etc/cloud/restic*.pass` (mode 0600, **copied off the Pi**)              |
| Live data                    | `/data/files`, `/data/db`, `/data/tmp`, `/data/thumbs`                    |
| Database snapshot for backup | `/data/backups/cloud.sqlite` (written by the API, never the live DB)      |

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
sudo systemctl enable --now cloud-backup.timer cloud-restore-test.timer cloud-health.timer
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
   sudo mkdir -p /data/db /data/tmp /data/thumbs
   sudo find /data/db -mindepth 1 -delete
   sudo cp /data/backups/cloud.sqlite /data/db/cloud.sqlite
   sudo chown -R 1000:1000 /data
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
