# Deploying the command centre on AWS (demo)

One EC2 server runs two containers: **Caddy** (HTTPS, certificates) in front of
**the app** (dashboard + API + SQLite, from the repository's `Dockerfile`).
Everything the server needs is in `deploy/`.

```
browser ──HTTPS──► EC2 t4g.small (Ubuntu, Docker)
                     ├─ caddy  :80/:443  Let's Encrypt certificate, gzip/zstd
                     └─ app    :8787     dashboard · /api · /basemap · /fonts
```

This is the demo set-up: one server, no load balancer, no CI deploys. About
**US$20 a month** while it runs (instance ≈ $15, disk ≈ $2, public IP ≈ $3.60),
nothing once it is terminated.

Values used below — change them if yours differ:

| | |
|---|---|
| Region | `ap-southeast-1` (Singapore) |
| Dashboard address | `cc.sgjburbansideprojects.brianhar.site` |
| Repository | `https://github.com/BLTC-520/testing-urban` (public) |

---

## 0. Before AWS: put the code on GitHub

The server clones the repository, so the branch must be pushed:

```bash
git push -u origin feat/command-centre-deploy
```

Optional but worth a minute: **Billing → Budgets → Create budget → Zero spend /
monthly cost budget**, so an instance left running cannot quietly eat the credits.

## 1. Launch the server

**EC2 → Instances → Launch instances**

| Setting | Value |
|---|---|
| Name | `sgjb-command-centre` |
| AMI | **Ubuntu Server 24.04 LTS**, architecture **64-bit (Arm)** |
| Instance type | **t4g.small** (2 vCPU, 2 GB) |
| Key pair | **Create new key pair** → RSA, `.pem` → it downloads; keep it |
| Network settings → Edit | Create security group, three inbound rules: |
| | SSH, port 22, source **My IP** |
| | HTTP, port 80, source **Anywhere** (`0.0.0.0/0`) |
| | HTTPS, port 443, source **Anywhere** (`0.0.0.0/0`) |
| Storage | **20 GiB gp3** (Docker images and build cache need room) |

Then **Launch instance**.

> Why Arm: t4g is AWS Graviton, cheaper than the Intel equivalent, and the same
> architecture as an Apple-silicon Mac — the image built and tested locally is
> the one that runs here.

## 2. Give it a fixed address

An instance's public IP changes on every stop/start; DNS needs one that doesn't.

**EC2 → Elastic IPs → Allocate Elastic IP address → Allocate**, then select it →
**Actions → Associate Elastic IP address** → choose the instance → **Associate**.

Note the address (below: `13.250.x.x`).

## 3. Point the subdomain at it (Cloudflare)

`brianhar.site` is on Cloudflare. **DNS → Records → Add record**:

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| A | `cc.sgjburbansideprojects` | `13.250.x.x` | **DNS only** (grey cloud) |

**DNS only matters.** With the orange cloud, Cloudflare sits in front and Caddy
cannot complete Let's Encrypt's check for its own certificate (and Cloudflare's
free certificate does not cover a name two levels deep).

Check it, from your Mac:

```bash
dig +short cc.sgjburbansideprojects.brianhar.site    # → 13.250.x.x
```

## 4. Connect

```bash
chmod 400 ~/Downloads/sgjb-command-centre.pem
ssh -i ~/Downloads/sgjb-command-centre.pem ubuntu@13.250.x.x
```

## 5. Install Docker, add swap

On the server:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

# 2 GB of RAM is enough to run the app but tight for building it (vue-tsc and
# Vite); swap stops the build being killed for memory.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

exit    # log out and back in so the docker group applies
```

```bash
ssh -i ~/Downloads/sgjb-command-centre.pem ubuntu@13.250.x.x
docker version    # should show both Client and Server
```

## 6. Get the code and configure it

```bash
git clone https://github.com/BLTC-520/testing-urban.git
cd testing-urban
git checkout feat/command-centre-deploy     # or stay on main once it is merged
cd deploy
nano .env
```

`deploy/.env` (gitignored — it never leaves the server):

```bash
DOMAIN=cc.sgjburbansideprojects.brianhar.site
CESIUM_ION_TOKEN=paste-your-token-here
```

In **Cesium ion → Access Tokens → your token**, if you restricted its allowed
URLs, add `https://cc.sgjburbansideprojects.brianhar.site`. Otherwise the 3D
buildings will be refused there.

## 7. Build and start

```bash
docker compose up -d --build
```

The first build takes several minutes on a t4g.small: it builds the dashboard,
builds the SQLite database and runs the 20 verification checks inside the
image. Watch Caddy fetch the certificate:

```bash
docker compose logs -f caddy     # look for "certificate obtained successfully"; Ctrl-C to stop watching
docker compose ps                # app should say (healthy)
```

Open **https://cc.sgjburbansideprojects.brianhar.site** — the dashboard, with
the *3D buildings* switch if the token is set.

## 8. Turn on the button on the main site

The React site's **Command Centre ↗** button appears once it knows the address.

1. **GitHub → repository → Settings → Secrets and variables → Actions →
   Variables → New repository variable**: `DASHBOARD_URL` =
   `https://cc.sgjburbansideprojects.brianhar.site`
2. The site deploys from `main`, and the button's code is on the feature
   branch: open a pull request and merge it. The merge runs the *Deploy site*
   workflow, which bakes the address in.

---

## Day to day

**Deploy a change** (after pushing it):

```bash
cd ~/testing-urban && git pull && cd deploy && docker compose up -d --build
```

**Logs:** `docker compose logs -f app` · **Restart:** `docker compose restart`

**Pause** (keeps everything, stops the instance charge): EC2 → instance →
**Instance state → Stop**. Start it again later; the Elastic IP keeps the
address, and the containers come back by themselves (`restart: unless-stopped`).
The Elastic IP still costs ≈ $3.60/month while held.

**Tear down** (stops all charges): **Terminate** the instance, then **Elastic
IPs → Release**. Remove the Cloudflare record.

## No domain? Plain HTTP on the IP

For a quick look before DNS is set up, in `deploy/.env`:

```bash
DOMAIN=:80
```

then `docker compose up -d --build` and open `http://13.250.x.x`. Caddy serves
plain HTTP and asks for no certificate. Fine for a first test; use the domain
for anything you send to people (and add `http://13.250.x.x` to the ion
token's allowed URLs if it is restricted).

## When something is wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Build stops with `Killed` or exit 137 | Out of memory | Add the swap in step 5; rebuild |
| Caddy log: `challenge failed`, no HTTPS | DNS not pointing here yet, orange cloud on, or port 80 closed | `dig` the name; set *DNS only*; check the security group has 80 and 443 |
| `502 Bad Gateway` | The app container is not running | `docker compose ps`, `docker compose logs app` |
| Page loads but no *3D buildings* switch | Token missing when the image was built | Check `deploy/.env`, then `docker compose build --no-cache app && docker compose up -d` |
| Switch is there, no buildings appear | ion refuses the token for this address | Add the dashboard URL to the token's allowed URLs |
| `ssh: connection timed out` | Your IP changed since "My IP" | Security group → edit the SSH rule → My IP |
