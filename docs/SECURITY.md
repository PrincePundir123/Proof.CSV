# Execution boundary and its practical limits

## Implemented controls

| Concern | Control | Evidence |
|---|---|---|
| Host/app access | No host mounts or Docker socket; separate container; nonroot process | Docker creation settings and boundary probe |
| Credentials | Fixed explicit sandbox environment; inference calls remain in Node | Credential-absence probe and command tests |
| Network access | Docker `--network none` | Outbound connectivity probe |
| Persistent changes | Read-only root; bounded tmpfs for working directories | Root-write probe |
| Unbounded runtime | Python child timeout; outer Docker watchdog; whole process-group termination | Infinite-loop test and execution log |
| Memory/process abuse | 256 MB RAM/swap ceiling, 0.5 CPU, 64 PIDs, bounded file descriptors | Creation flags, daemon resource-support check and actual cgroup v2 integration assertions |
| Output flooding | Child file-size limits, bounded logs, bounded subprocess output, max 8 files / 4 MB | Artifact validation tests |
| Cross-task leftovers | Fresh named container per attempt; force removal, then independent absence check | `destroyed` field and fresh-workspace integration test |
| Cleanup failure | Stop accepting execution until operator checks and restart | Cleanup-failure test |
| Cross-user data access | Random HttpOnly session cookie; owner checks on datasets/jobs/files | HTTP ownership test |
| Upload ambiguity | Bounded CSV parser; unique headers; consistent rows; quoted-field validation | CSV parser tests |
| Host path traversal | Fixed static-file allowlist; in-memory artifacts; strict filename validation | HTTP path and artifact tests |
| Browser script injection | Render user/model text with DOM `textContent`; CSP; image magic checks; attachment-only outputs | Malicious-cell browser test |
| Inference spending | Global daily call count, 2 concurrent jobs, session rate limits | Budget/concurrency logic |

## Actual runtime validation is required

Tests with a mocked Docker adapter check orchestration and fail-closed behavior. They do not prove Linux isolation. Run `npm run test:sandbox` on the dedicated Vultr host and run a real inference-backed analysis before presenting the project as deployed.

## Limits

- Docker containers share a kernel. Use a dedicated VM, current patches, and optionally gVisor/per-task instances for a stronger boundary. Never run privileged containers or mount the host Docker socket into the sandbox.
- Rootless Docker needs cgroup v2/systemd to enforce the resource controls. Readiness fails if memory/PID/CPU limits are not supported. A misconfigured daemon must be fixed rather than bypassing this check.
- SHA-256 verifies downloaded artifacts match the executed output. It does not establish that the generated statistics or interpretation are correct.
- Model plans, dataset cells, report contents, and logs are untrusted. Data are framed as data in prompts, but prompt separation cannot guarantee that a model ignores every injection; containment constrains the execution regardless.
- Anonymous sessions and in-memory budgets are suitable for a controlled hackathon demo. For sustained public use, add authenticated users, durable quotas, cost monitoring, and durable metadata. The daily call count resets on restart. Set provider-side billing limits.
- Process/VM crashes can leave an orphaned container. Runtime watchdogs and normal finally-block cleanup cannot execute after a host crash. Inspect only labeled application containers before restarting. Use an external supervisor/reaper for a sustained service.
- Reports expire in memory and are not backed up. Do not use the demo as the only copy of important data. A downloaded CSV may contain formulas from its input; spreadsheet software interpretation is outside this code sandbox.

The Windows development setup uses Docker in Ubuntu WSL. The real Docker integration check passed on this machine, including resource-control assertions. Local AI mode binds the app and model to loopback addresses. It is separate from the required Vultr-hosted hackathon deployment; validate again on that host before submitting.
