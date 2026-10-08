# Record the real hackathon demo

Target duration: 4 minutes. Record the real HTTPS deployment after `npm run test:sandbox` passes. Keep the submission video within the guide's 5-minute/300-MB limit. This script is preparation, not a recording.

## 0:00–0:25 — The problem

“Spreadsheet answers should be useful and inspectable. ProofCSV turns a question into real code execution, then gives you the result and the evidence behind it.”

Show the public web application and its connected status. State the target user: an operator/founder/analyst with a CSV and a specific question.

## 0:25–1:25 — A real analysis

Upload `data/sample-sales.csv`. Ask: “Show monthly revenue as a chart and explain the biggest changes.” Click **Run analysis**, not **Explore a sample report**.

Show the task progressing through planning, execution, and verification. Open the generated chart and download the monthly CSV. Explain that the backend and sandbox run on Vultr, with all model calls routed through Vultr Serverless Inference.

## 1:25–2:05 — Evidence and repair

Open the executed code and logs. Download the execution record. Highlight code/file SHA-256 hashes and verified container removal. If a real execution failed and retried, show that recorded retry; do not insert or fabricate an error. A retry is supported but not guaranteed for a successful first run.

“The error, when there is one, goes back to the agent for one repair. Each attempt gets a fresh sandbox.”

## 2:05–2:55 — The required containment moment

Open **Safety Lab**. Click **Test the time limit**. Show the loop executing, then the task stopped after 3 seconds and the container destroyed. Immediately open the application again or run the isolation check to show it remains responsive.

“This is an actual infinite loop inside the sandbox. The time limit stops it. The backend then removes the container and independently checks that it no longer exists.”

Open its evidence record. If useful, show `docker ps -a --filter label=proofcsv.managed=true` after completion. Record no API key or private account page.

## 2:55–3:35 — Architecture

Show slide 4. Explain: public browser → Node backend on Vultr VM → Vultr Inference → isolated Docker execution → validated output.

“Keys stay in the backend. The sandbox has no network, host mounts, or credentials. Runs have time, memory, CPU, and process caps.”

## 3:35–4:00 — Value and honest limits

“Small teams get usable files and a record of how an answer was produced. This demo uses a bounded single-VM deployment. Next steps include authenticated teams, durable report storage and quotas, and a stronger sandbox runtime.”

Finish with the real demo URL and public repository link. Explain any pre-kickoff preparation if required by the organizers. Ensure the video shows actual execution and containment, rather than presenting the local sample preview as an agent run.
