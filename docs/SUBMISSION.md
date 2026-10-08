# Submission preparation

## Title

ProofCSV

## Short description

Ask your spreadsheet a question. ProofCSV executes Python safely on Vultr and returns real charts, cleaned files, code, logs, and evidence of sandbox cleanup.

## Long description

ProofCSV helps small teams turn spreadsheets into useful, inspectable results. A user uploads a CSV and asks a question in plain English. A central backend on a Vultr virtual machine uses Vultr Serverless Inference to plan the task and generate Python, then dispatches that code into a separate disposable Docker sandbox on Vultr.

The sandbox has no network access, host mounts, Docker socket, or inference credentials. It runs as a nonroot user with a read-only root filesystem, bounded temporary storage, and time, memory, CPU, and process limits. When code fails, the agent can use its actual error to make one visible repair attempt in a fresh sandbox.

The user receives computed metrics, charts or cleaned files, the executed code, logs, and artifact hashes. Each container is destroyed and its removal independently checked. A Safety Lab demonstrates an infinite loop stopped by a time limit and probes the filesystem, network, and credential boundaries.

ProofCSV emphasizes practical analysis and verifiable execution. The interface includes a separately labeled sample preview that performs no AI call or sandbox execution. The public demonstration must show a real inference-backed run on the configured Vultr VM.

## Technologies and category

- Main pattern: Sandboxed code execution / CSV Analyst.
- Technologies: Vultr VM, Vultr Serverless Inference, Docker, Node.js, Python, pandas, NumPy, matplotlib, HTML/CSS/JavaScript.
- Categories: AI agents, data analysis, developer tools, sandboxed execution.
- Hosting platform: Vultr.

## Files prepared

- Cover: `public/cover.png` (1600 × 900) with original SVG source.
- Slides: `docs/presentation.pdf`; editable presentation source at `public/slides.html`.
- Architecture/setup: `README.md`, `docs/DEPLOYMENT.md`.
- Video narration: `docs/DEMO.md`.

## Outstanding before submission

- [ ] Confirm eligibility of pre-kickoff code with the event organizers; disclose prior preparation.
- [ ] Set up Vultr credits, VM, and Serverless Inference access.
- [ ] Run real Docker integration tests successfully on Vultr.
- [ ] Run and inspect a real inference-backed analysis on Vultr.
- [ ] Publish a working HTTPS demo URL.
- [ ] Create a public GitHub repository without credentials or uploaded user data.
- [ ] Record/upload a real demo video within the submission limit, including actual containment.
- [ ] Add the real URLs to the submission form and submit before the confirmed deadline.
- [ ] Recheck any new tracks, partner requirements, licensing instructions, and schedule updates.

The live dashboard checked on October 4, 2026 lists submissions closing November 8 at 22:00 UTC, which is November 9 at 03:30 IST. The pasted schedule differed by one hour, so recheck the official dashboard before submission: https://lablab.ai/ai-hackathons/vultr-hackathon/live.

This preparation is not a submitted, deployed, or prize-eligible entry until the outstanding steps are completed.
