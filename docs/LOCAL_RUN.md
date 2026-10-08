# Run the complete app on this Windows computer

Double-click `START-LOCAL.bat`, then open http://localhost:3000. The launcher starts the local AI and the web app in the background. It also checks Docker in Ubuntu WSL. Running the launcher again reuses the existing model and app.

To stop the web app and AI, let active analyses finish and double-click `STOP-LOCAL.bat`. It checks process identities and refuses to stop an active analysis. Docker/Ubuntu services can remain available for other projects.

The status should say **Local AI ready**. Upload your CSV, enter a question and click **Run analysis**. You can also click **Try our sample data** and then **Run analysis**. **Explore a sample report** remains a fixed preview and does not use AI.

Click **browse files** to choose a `.csv` file from your laptop (up to 2 MB, with a header row). After loading a file or sample, use **Choose another file** to replace it. Excel `.xlsx` and `.xls` files need to be saved as CSV first in Excel using **Save As → CSV**. If the browser still shows the previous layout after an update, press **Ctrl + F5** to refresh.

The file window shows all file types so files are not hidden by a CSV filter; the app accepts CSV data for analysis and explains unsupported file types. If you have no CSV, click **Download example CSV**, then select the downloaded `sample-sales.csv` from your Downloads folder. If Windows still says no items match, clear the file window's search box and open the folder containing your file.

The app can create charts, calculate metrics, clean CSV data and return downloadable files. Open **Safety lab** to run the timeout and isolation checks. Local AI can take a few minutes, depending on your CPU and other running programs. Generated analysis can still make mistakes; inspect the results and code.

## Installed components

- Node.js serves the app on port 3000.
- Official llama.cpp CPU runtime serves Qwen3.5-4B, Q4_K_M, on port 11434, using the [Unsloth quantization](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF) of the [Qwen model](https://huggingface.co/Qwen/Qwen3.5-4B). It needs no API key. The downloaded runtime/model are under `runtime/local-ai` and excluded from the source archive.
- Docker inside the existing Ubuntu WSL distribution runs the trusted `proofcsv-sandbox:1` image. Generated Python runs only inside disposable offline containers, with resource limits and verified cleanup.
- While the app is running, a lightweight Docker heartbeat keeps Ubuntu WSL awake during long AI requests. It stops with the web app and uses no AI calls.
- `.env` selects local AI and WSL Docker. It is ignored by Git. Public deployment defaults to Vultr, and local mode requires loopback addresses.

The app stores uploads and reports in memory. They expire after 60 minutes; restarting the web app clears them. Download files you want to keep.

The real local workflow has passed on this computer, including the monthly revenue chart/CSV, artifact hashes, correct data cleaning, timeout and isolation tests. The start/stop launchers have also passed. These checks use the installed model and Docker, with no API fixtures.

## Verify the complete workflow

```powershell
npm.cmd run test:sandbox
npm.cmd run verify:local
```

The first command verifies actual Docker execution, resource caps, boundaries, timeout and cleanup. The second uses the real local model and browser to check monthly revenue values, PNG/CSV downloads and their hashes, data cleaning and both Safety Lab tests. It saves local evidence and a screenshot in `runtime/local-verification`. It is separate from the browser fixture tests.

## Troubleshooting

The launcher reports startup errors. Logs are in `runtime/local-ai`: `model.stderr.log`, `app.stderr.log` and `app.stdout.log`. If Docker is unavailable, start Ubuntu WSL and check `wsl -d Ubuntu -u root -- docker info`. If a different app already uses port 3000 or 11434, stop that app before starting ProofCSV.

To reinstall the model/runtime, run `python scripts/setup-local-ai.py`. It downloads about 2.7 GB and verifies publisher SHA-256 hashes. To rebuild the sandbox:

```powershell
wsl -d Ubuntu -u root -- docker build -t proofcsv-sandbox:1 /mnt/c/Users/princ/OneDrive/Desktop/solproject/sandbox
```

## Hackathon deployment

This local setup is for development and testing. The hackathon submission still needs the app hosted on Vultr with all model calls through Vultr Serverless Inference. Follow [DEPLOYMENT.md](DEPLOYMENT.md), set `MODEL_PROVIDER=vultr` and `DOCKER_TRANSPORT=native`, and configure the Vultr key/model on that server.
