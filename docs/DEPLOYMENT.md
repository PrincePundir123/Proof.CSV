# Deploy ProofCSV on Vultr

These instructions prepare a dedicated Ubuntu 24.04 Vultr VM for the real hackathon demo. This workspace has not created a cloud server or spent credits.

## 1. Set up the account

Create your Vultr account and redeem the hackathon coupon once the organizers publish it. The event promises $200 of credits per participant; the code is currently unannounced. Check the account's billing limits and any credit restrictions before provisioning.

Enable Vultr Serverless Inference and create its key. Find a currently available coding-capable model in the model catalog. Keep the key in the server's private `.env`; do not put it in the repository, frontend, screenshots, slides, or sandbox.

Official resources:

- Event: https://lablab.ai/ai-hackathons/vultr-hackathon
- Inference implementation: https://docs.vultr.com/how-to-use-vultr-serverless-inference-in-nodejs
- API/model catalog: https://api.vultrinference.com/
- Rootless Docker: https://docs.docker.com/engine/security/rootless/
- Docker runtime controls: https://docs.docker.com/engine/containers/run/

## 2. Provision the VM

Use a dedicated Ubuntu 24.04 VM with at least 2 GB of RAM (4 GB gives comfortable build headroom). Backend execution and orchestration both live here. Point a domain to its IP. Open ports 80/443 for HTTPS and restrict SSH to your address. Do not expose port 3000 publicly.

Install supported Node.js 22+ and Caddy using their official installation instructions. Create a dedicated Linux user named `proofcsv`. Install rootless Docker for that user following the official Docker instructions. Enable systemd lingering so its user services continue after SSH logout:

```bash
sudo loginctl enable-linger proofcsv
```

Rootless resource limits require cgroup v2 and systemd delegation. Verify `docker info` shows supported memory, PID, and CPU CFS controls. ProofCSV disables execution if it cannot confirm these controls. Keep Docker's default seccomp profile enabled; do not use a privileged or unconfined daemon configuration. Do not add the app user to the rootful `docker` group as a shortcut.

## 3. Copy the project and configure it

Put this repository at `/home/proofcsv/proofcsv`, owned by the `proofcsv` user. As that user:

```bash
cd /home/proofcsv/proofcsv
cp .env.example .env
chmod 600 .env
mkdir -p runtime
docker build -t proofcsv-sandbox:1 sandbox
```

Edit `.env` on the server:

```dotenv
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://your-domain.example
COOKIE_SECURE=true
VULTR_SERVERLESS_INFERENCE_API_KEY=your-private-key
VULTR_MODEL=your-current-vultr-model-id
SANDBOX_IMAGE=proofcsv-sandbox:1
SANDBOX_TIMEOUT_SECONDS=20
MAX_CONCURRENT_JOBS=2
MAX_DAILY_MODEL_CALLS=100
DATA_TTL_MINUTES=60
```

Do not guess a model ID from old examples: choose one available to your account. Inference calls cannot be redirected to another provider through environment variables. Pin the built image to its immutable image ID/digest in `SANDBOX_IMAGE` after validating it if you want reproducible deployment.

## 4. Run the real sandbox checks

```bash
npm ci
npm test
npm run check
npm run test:sandbox
```

The final command must pass. It executes the sample analysis, checks generated PNG/JSON/CSV output, probes the filesystem/network/credential boundary, terminates a real infinite loop, verifies container removal, and confirms a fresh next workspace. It needs Docker and does not need an inference key.

Run only one ProofCSV backend instance on this VM. The application is a bounded hackathon deployment, not a replicated service: session state, reports, budget counters, and concurrency control are in memory.

## 5. Keep the backend running

As `proofcsv`, copy `deploy/proofcsv.service` to `~/.config/systemd/user/proofcsv.service`, then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now docker.service
systemctl --user enable --now proofcsv.service
systemctl --user status proofcsv.service
```

The supplied service expects Node at `/usr/bin/node` and the project at `/home/proofcsv/proofcsv`. Adjust those paths if your installation differs. It uses the rootless Docker socket in the user's runtime directory. Memory usage and filesystem settings are bounded without placing a rootful Docker socket into a web container.

## 6. Add HTTPS

Edit `deploy/Caddyfile` to replace `your-domain.example`. Install it as Caddy's configuration and validate it before reloading the service:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The domain, `PUBLIC_ORIGIN`, and browser URL must match, or same-origin POST checks will reject writes. `COOKIE_SECURE=true` is required for the public HTTPS deployment. Caddy supplies TLS; the backend remains bound to localhost.

## 7. Verify the public product

1. Open the public URL in a fresh browser.
2. Confirm the status says **Execution ready**.
3. Upload `data/sample-sales.csv` and run a question through **Run analysis**. Do not use the sample-preview button as evidence of live execution.
4. Download the generated chart, monthly CSV, JSON report, and execution record.
5. Inspect the code hash, file hashes, actual logs, and destroyed-container evidence.
6. Run both Safety Lab tests and record the real infinite-loop containment moment.
7. Confirm `docker ps -a --filter label=proofcsv.managed=true` shows no leftover containers after completion.
8. Test from a second browser to confirm session isolation and the usable public URL.

After a VM/process crash, inspect managed containers before restarting, and remove only orphaned containers belonging to this application. Do not delete other workloads. A cleanup failure pauses execution until you resolve it and restart the backend.

## 8. Finish the hackathon submission

Create a public GitHub repository containing the source and docs (exclude `.env`, node_modules, runtime data, and test recordings). Publish the demo URL. Record a real demo following `docs/DEMO.md`, upload the PNG cover and PDF slides, and paste the submission descriptions.

Before the hackathon, verify the policy on code prepared before kickoff. The rule book was not readable through the research interface used here; this guide does not assert that a prebuilt entry is eligible.
