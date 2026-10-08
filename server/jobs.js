import { randomUUID } from 'node:crypto';
import { HttpError } from './config.js';

export function normalizeReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The execution did not create a valid report.');
  const text = (value, length = 1500) => typeof value === 'string' ? value.slice(0, length) : '';
  if (!text(input.title) || !text(input.summary)) throw new Error('The executed report needs a title and summary.');
  return {
    title: text(input.title, 160), summary: text(input.summary), chartTitle: text(input.chartTitle, 160),
    metrics: Array.isArray(input.metrics) ? input.metrics.slice(0, 4).map(metric => ({ label: text(metric?.label, 60), value: ['string', 'number'].includes(typeof metric?.value) ? String(metric.value).slice(0, 80) : '', detail: text(metric?.detail, 150) })) : [],
    findings: Array.isArray(input.findings) ? input.findings.filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 600)) : [],
    series: Array.isArray(input.series) ? input.series.filter(item => typeof item?.label === 'string' && Number.isFinite(item?.value)).slice(0, 50).map(item => ({ label: item.label.slice(0, 80), value: item.value })) : [],
  };
}

export const SAFETY_CODE = {
  timeout: 'print("Starting the bounded infinite-loop test.", flush=True)\nwhile True:\n    pass\n',
  boundary: `import os, json, socket
from pathlib import Path
checks = {}
try:
    Path('/etc/proofcsv-probe').write_text('test')
    checks['root_write_blocked'] = False
except OSError:
    checks['root_write_blocked'] = True
checks['inference_key_absent'] = 'VULTR_SERVERLESS_INFERENCE_API_KEY' not in os.environ
checks['docker_socket_absent'] = not Path('/var/run/docker.sock').exists()
checks['host_mount_absent'] = not Path('/host').exists()
try:
    socket.create_connection(('1.1.1.1', 443), timeout=1).close()
    checks['network_blocked'] = False
except OSError:
    checks['network_blocked'] = True
passed = all(checks.values())
report = {'title':'Isolation check', 'summary':'All isolation probes passed.' if passed else 'An isolation probe failed.', 'metrics':[{'label':'Checks passed','value':str(sum(checks.values())) + '/5','detail':'Observed inside this container'}], 'findings':[key.replace('_',' ') + ': ' + str(value) for key,value in checks.items()]}
Path('/workspace/output/report.json').write_text(json.dumps(report))
print(json.dumps(checks))
if not passed: raise RuntimeError('Isolation probe failed')
`,
};

export function createJobs(config, sandbox, inference) {
  const jobs = new Map();
  let running = 0, blocked = false;
  const event = (job, type, message) => job.events.push({ type, message, time: new Date().toISOString() });
  const state = (job, value, message) => { job.status = value; event(job, value, message); };
  function publicJob(job) {
    const { owner, files, ...safe } = job;
    return { ...safe, files: files.map(({ buffer, ...file }) => ({ ...file, url: `/api/jobs/${job.id}/files/${encodeURIComponent(file.name)}` })) };
  }
  async function work(job, dataset) {
    try {
      if (job.kind !== 'analysis') {
        state(job, 'executing', job.kind === 'timeout' ? 'Running a bounded infinite loop inside a disposable sandbox.' : 'Checking filesystem, network, credential, and host boundaries.');
        job.code = SAFETY_CODE[job.kind];
        const result = await sandbox.execute(job.code, 'placeholder\n1\n', job.kind === 'timeout' ? 3 : config.timeout);
        job.attempts.push({ number: 1, code: job.code, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, timedOut: result.timedOut, evidence: result.evidence });
        job.files = result.files;
        const passed = job.kind === 'timeout' ? result.timedOut && result.evidence.destroyed : result.exitCode === 0 && result.evidence.destroyed;
        if (!passed) throw new Error('The containment test did not pass. Inspect the execution record.');
        if (job.kind === 'timeout') {
          job.report = { title: 'The loop stopped. Your app kept running.', summary: 'The runner interrupted an infinite loop at its 3-second time limit, then the backend destroyed the container and verified its removal.', metrics: [{ label: 'Time limit', value: '3 sec', detail: 'Enforced inside the sandbox' }, { label: 'Container', value: 'Destroyed', detail: 'Removal independently checked' }], findings: ['The unbounded task was stopped.', 'The disposable container was removed.', 'The server can accept another task.'], series: [] };
        } else job.report = normalizeReport(JSON.parse(result.files.find(file => file.name === 'report.json')?.buffer.toString('utf8') || 'null'));
        state(job, 'contained', 'Containment verified; the sandbox has been destroyed.');
        return;
      }
      let previous;
      for (let attempt = 1; attempt <= 2; attempt++) {
        state(job, attempt === 1 ? 'planning' : 'repairing', attempt === 1 ? `The agent is planning your analysis through ${config.provider === 'local' ? 'your local AI model' : 'Vultr Inference'}.` : 'The agent is reading the actual error and preparing a correction.');
        const plan = await inference.plan(job.question, dataset.profile, previous);
        job.title = plan.title; job.plan = plan.plan; job.code = plan.code;
        state(job, 'executing', `Attempt ${attempt}: running generated Python in an isolated container.`);
        const result = await sandbox.execute(plan.code, dataset.csv);
        const record = { number: attempt, code: plan.code, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, timedOut: result.timedOut, evidence: result.evidence };
        job.attempts.push(record);
        event(job, 'cleanup', `Attempt ${attempt}: container destroyed and removal verified.`);
        let failure = result.timedOut ? 'The execution reached its time limit.' : result.exitCode !== 0 ? result.stderr || 'Code exited with an error.' : '';
        if (!failure) {
          try {
            const file = result.files.find(file => file.name === 'report.json');
            if (!file) throw new Error('No report.json was produced.');
            job.report = normalizeReport(JSON.parse(file.buffer.toString('utf8')));
          } catch (error) { failure = error.message; }
        }
        if (failure) {
          record.validationError = failure;
          if (attempt === 2) throw new Error('The code could not complete after two attempts. Review the execution log and try a more specific question.');
          previous = { plan, stderr: failure.slice(0, 12_000), stdout: result.stdout };
          continue;
        }
        job.files = result.files;
        state(job, 'verifying', 'Checking the report, artifact hashes, and sandbox cleanup.');
        try { job.explanation = await inference.explain(job.question, job.report, result.stdout); }
        catch { job.explanation = job.report.summary; event(job, 'notice', 'The executed result is available; the additional AI explanation could not be generated.'); }
        state(job, 'completed', 'Your executed results and evidence are ready.');
        return;
      }
    } catch (error) {
      if (/cleanup could not be verified/i.test(error.message)) blocked = true;
      job.error = error.message;
      state(job, 'failed', error.message);
    } finally { running--; }
  }
  return {
    get blocked() { return blocked; },
    get running() { return running; },
    start(owner, dataset, question, kind = 'analysis') {
      if (blocked) throw new HttpError(503, 'Execution is paused because sandbox cleanup needs attention.');
      if (running >= config.maxConcurrent) throw new HttpError(429, 'All execution slots are busy. Try again shortly.');
      if ([...jobs.values()].some(job => job.owner === owner && !['completed', 'contained', 'failed'].includes(job.status))) throw new HttpError(429, 'Please wait for your current task to finish.');
      if (jobs.size >= 24) throw new HttpError(429, 'The report store is full. Try again after older reports expire.');
      if (!['analysis', 'timeout', 'boundary'].includes(kind)) throw new HttpError(400, 'Choose a supported task type.');
      const job = { id: randomUUID(), owner, kind, question, filename: dataset?.filename || 'Containment test', created: Date.now(), status: 'queued', title: kind === 'analysis' ? 'Your analysis' : 'Containment test', plan: [], code: '', events: [], attempts: [], files: [] };
      jobs.set(job.id, job); event(job, 'queued', 'Task accepted.'); running++;
      // Defer work so the caller can return the job ID before any slow API request.
      setImmediate(() => void work(job, dataset));
      return publicJob(job);
    },
    get(owner, id) {
      const job = jobs.get(id);
      if (!job || job.owner !== owner) throw new HttpError(404, 'This report was not found or has expired.');
      return publicJob(job);
    },
    file(owner, id, name) {
      const job = jobs.get(id);
      if (!job || job.owner !== owner) throw new HttpError(404, 'File not found.');
      const file = job.files.find(file => file.name === name);
      if (!file) throw new HttpError(404, 'File not found.');
      return file;
    },
    list(owner) { return [...jobs.values()].filter(job => job.owner === owner).reverse().map(publicJob); },
    sweep() { for (const [id, job] of jobs) if (Date.now() - job.created > config.ttlMs && ['completed', 'contained', 'failed'].includes(job.status)) jobs.delete(id); },
  };
}
