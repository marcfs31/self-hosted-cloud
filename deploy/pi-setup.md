# Raspberry Pi 5 first-boot runbook

From a bare Pi to `https://<host>.<tailnet>.ts.net/api/health` answering on your phone.
Nothing is built on the Pi: CI publishes arm64 images, the Pi only pulls them.

Placeholders: `<admin>` your Linux username, `<host>` the Pi's hostname (`cloud`),
`<tailnet>` your tailnet name (e.g. `tail1234`), `<owner>` your GitHub user or org
(lowercase).

## 0. Hardware

| Part                                                                   | Notes                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Raspberry Pi 5, 8 GB                                                   |                                                                           |
| Official 27 W USB-C power supply                                       | Underpowered supplies cause SSD dropouts under load.                      |
| Active cooler (or a case with a fan)                                   | Thumbnailing and backups peg the CPU.                                     |
| M.2 HAT + NVMe SSD (OS), or a USB 3 SSD                                | No SD card for the OS: SD cards die under write load.                     |
| Data disk: a second SSD, or a spare partition on the NVMe              | Mounted at `/data`. A separate disk makes disaster recovery simpler.      |
| Backup disk: a USB disk, kept in a different place than the Pi         | Local restic repository (see `operations.md`).                            |
| Optional: UPS HAT                                                      | Power loss is survivable (SQLite WAL + atomic renames), a UPS is cheaper. |
| A computer with an NVMe-USB enclosure (or a USB-SSD adapter) + SSH key | To flash the disk.                                                        |

## 1. Flash Raspberry Pi OS Lite (64-bit) to the NVMe

1. On your computer, install Raspberry Pi Imager and attach the NVMe in the enclosure.
2. Choose device **Raspberry Pi 5**, OS **Raspberry Pi OS Lite (64-bit)**, storage = the NVMe.
3. Open the OS customisation: set hostname `<host>`, username `<admin>`, locale and
   timezone, Wi-Fi only if you cannot use Ethernet (prefer Ethernet), and under
   **Services** enable SSH with **public-key authentication only**; paste your public key
   (`~/.ssh/id_ed25519.pub`). Do not set a password you intend to use over SSH.
4. Write, move the NVMe to the HAT, power on with Ethernet connected. No SD card.
5. Find the Pi (`ping <host>.local` or your router's DHCP list) and log in:

```bash
ssh <admin>@<host>.local
```

## 2. Boot from NVMe

The Pi 5 tries SD, then NVMe, then USB by default, so with no SD card it boots the NVMe.
Make that explicit and current:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo rpi-eeprom-update -a            # stage a bootloader update if one is pending
sudo raspi-config                    # Advanced Options > Boot Order > NVMe/USB Boot
sudo reboot
```

After the reboot confirm the root filesystem is the NVMe:

```bash
findmnt -no SOURCE /     # expect /dev/nvme0n1p2
```

If the NVMe is not detected, add `dtparam=pciex1` (and optionally `dtparam=pciex1_gen=3`)
to `/boot/firmware/config.txt` and reboot.

## 3. Base system

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades apt-listchanges ufw smartmontools restic sqlite3 curl rsync
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes
sudo timedatectl set-timezone <Region/City>
sudo mkdir -p /var/log/journal                       # keep logs across reboots
```

Automatic reboot for kernel updates, outside the 03:30 backup window:

```bash
sudo tee /etc/apt/apt.conf.d/52cloud-unattended >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
sudo unattended-upgrade --dry-run --debug 2>&1 | tail -n 5
```

Debian security updates apply automatically. Docker and Tailscale come from their own apt
repositories and are **not** covered by this; run `sudo apt update && sudo apt upgrade`
for them monthly.

## 4. SSH hardening (keys only)

Keep your current SSH session open until the new settings are verified from a second one.

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers <admin>
EOF
sudo sshd -t && sudo systemctl reload ssh
```

The `00-` prefix matters: sshd uses the first value it reads, and the Imager may have
dropped its own file into `sshd_config.d/`. Verify in a **new** terminal that key login still
works and that this fails:

```bash
ssh -o PubkeyAuthentication=no <admin>@<host>.local     # expect: Permission denied
```

## 5. Docker Engine and Compose

Docker's official apt repository for Debian (arm64 is detected automatically):

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world
```

(`curl -fsSL https://get.docker.com | sudo sh` also works; Docker documents the apt
repository above as the preferred method for a machine you keep.)

Operate Docker with `sudo` rather than adding yourself to the `docker` group: that group
is root-equivalent.

## 6. Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/tailscale-install.sh
less /tmp/tailscale-install.sh        # read it, then:
sudo sh /tmp/tailscale-install.sh
sudo tailscale up --hostname=<host>
```

Open the printed login URL on your phone or laptop and approve the device. Then in the
Tailscale admin console (`login.tailscale.com/admin`):

1. **DNS**: turn on **MagicDNS**, and under **HTTPS Certificates** click **Enable HTTPS**.
2. **Machines**: note the full name, `<host>.<tailnet>.ts.net`. That is `CLOUD_DOMAIN`.
3. Optional: **Disable key expiry** for this machine so the Pi does not drop off the tailnet
   in six months.

Install the Tailscale app on your phone and laptop and sign in to the same tailnet.

Caddy gets its `*.ts.net` certificate from the host's `tailscaled` through its socket, which
the compose file mounts (`/var/run/tailscale/tailscaled.sock`). Nothing is opened on the
router; no public DNS record is needed.

## 7. Data disk at `/data`

Identify the disk (`lsblk -f`); the examples use `/dev/sda`. **Double-check the device
name: the next commands destroy its contents.**

```bash
sudo parted -s /dev/sda mklabel gpt mkpart data ext4 1MiB 100%
sudo mkfs.ext4 -L cloud-data /dev/sda1
sudo mkdir /data
sudo chattr +i /data                  # while unmounted, writes to /data fail instead of
                                      # silently filling the root filesystem
sudo blkid /dev/sda1                  # copy the UUID
echo 'UUID=<uuid>  /data  ext4  defaults,noatime,nofail  0  2' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /data
findmnt /data
```

If you use a spare partition on the NVMe instead, create it with `parted`/`raspi-config`
before the Imager step and use its device in place of `/dev/sda1`.

Directories, owned by uid/gid 1000, the `node` user inside the containers, except
`/data/status`, which is root-owned:

```bash
sudo mkdir -p /data/files /data/db /data/tmp /data/thumbs /data/backups /data/status
sudo chown -R 1000:1000 /data
sudo chmod 750 /data
sudo chown root:root /data/status        # after the chown -R above
sudo chmod 0755 /data/status
```

`/data/backups` holds the database snapshot the API writes (uid 1000). `/data/status` holds
the reports the host scripts (root) write for the admin dashboard; the API reads them, so
they are world-readable, but the directory is root-owned so the API cannot create or alter
them. The scripts do not create it: if `/data` is not mounted they fail instead of writing
reports onto the root filesystem.

Make Docker wait for the disk and for Tailscale. Without this a missing `/data` would let
the API start against an empty directory on the root filesystem:

```bash
sudo systemctl edit docker
```

```ini
[Unit]
RequiresMountsFor=/data
Wants=tailscaled.service
After=tailscaled.service
```

## 8. Firewall

Default deny; SSH and the web ports only from the tailnet and your LAN. Replace the LAN
subnet with yours (`ip -4 route | grep -v default`).

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 80,443 proto tcp
sudo ufw enable
sudo ufw status verbose
```

`allow in on tailscale0` trusts the whole tailnet (SSH included). Tighten it with
Tailscale ACLs if the tailnet is shared.

**Docker bypasses ufw.** Ports a container publishes are wired up in iptables before ufw's
rules apply, so `ufw` alone does not restrict `80/443` published by Caddy. The router has no
port forwards, so today that means "reachable from the LAN and the tailnet", which is the
intent. To make it tailnet-only, bind Caddy to the Tailscale address in `.env`:

```bash
echo "CLOUD_BIND_IP=$(tailscale ip -4)" | sudo tee -a /opt/cloud/.env
```

(The `docker` drop-in from section 7 makes sure `tailscaled` is up first.) Only Caddy
publishes ports; `web` and `api` are reachable on the compose network only.

## 9. Deploy the stack

Copy `deploy/` from the repository to `/opt/cloud` (from your computer):

```bash
rsync -a --exclude '.env' deploy/ <admin>@<host>.local:/tmp/cloud-deploy/
ssh <admin>@<host>.local 'sudo mkdir -p /opt/cloud && sudo rsync -a /tmp/cloud-deploy/ /opt/cloud/ && rm -rf /tmp/cloud-deploy'
```

Create the environment file:

```bash
cd /opt/cloud
sudo cp .env.example .env
sudo nano .env
```

```ini
CLOUD_DOMAIN=<host>.<tailnet>.ts.net
CLOUD_VERSION=0.2.0                                  # a published tag, without the "v"
CLOUD_IMAGE_PREFIX=ghcr.io/<owner>/self-hosted-cloud
```

Images are pulled from GitHub Container Registry. Either make the two packages public
(GitHub > Packages > `self-hosted-cloud-api` / `-web` > Package settings > Change
visibility), or `sudo docker login ghcr.io` with a token that has only `read:packages`.

```bash
cd /opt/cloud
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps          # api, web, caddy: all "healthy" after about a minute
```

The first start has Caddy request the certificate; `sudo docker compose logs caddy` shows
it. Expect `certificate obtained successfully` for your `.ts.net` name.

## 10. Verify

On the Pi:

```bash
curl -fsS https://<host>.<tailnet>.ts.net/api/health
```

Expected: HTTP 200 and `{"status":"ok","version":"…","checks":{"storage":"ok"}}`.

From a phone **off Wi-Fi** (mobile data, Tailscale app connected): open
`https://<host>.<tailnet>.ts.net/api/health` in the browser. The page loads over HTTPS with no
certificate warning and shows the same JSON. Open `https://<host>.<tailnet>.ts.net/` and you
get the UI.

With Tailscale disconnected on the phone the same URL must **not** load. If it does, the
router is forwarding ports or `CLOUD_BIND_IP` was not applied.

Finish with backups and monitoring: `operations.md`, sections "Backups" and "Monitoring".

## Troubleshooting

| Symptom                                   | Check                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Caddy cannot get a certificate            | HTTPS certificates enabled in the tailnet; `/var/run/tailscale/tailscaled.sock` exists     |
| `docker compose` says `set CLOUD_VERSION` | `/opt/cloud/.env` missing or the command ran in another directory                          |
| `api` unhealthy, `storage":"unavailable"` | `/data` not mounted or not owned by 1000:1000 (`ls -ln /data`)                             |
| `pull access denied`                      | GHCR package is private and the Pi is not logged in, or `CLOUD_IMAGE_PREFIX` has uppercase |
| Docker will not start after reboot        | `/data` failed to mount (`systemctl status data.mount`); the drop-in is doing its job      |
