import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readConfig, HttpError } from './config.js';
import { profileCsv } from './csv.js';
import { createInference } from './inference.js';
import { createSandbox } from './sandbox.js';
import { createJobs } from './jobs.js';
import { sampleData } from './sample.js';

const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/logo.svg', ['logo.svg', 'image/svg+xml']],
  ['/cover.svg', ['cover.svg', 'image/svg+xml']], ['/slides', ['slides.html', 'text/html; charset=utf-8']],
  ['/cover.png', ['cover.png', 'image/png']],
]);

export function createApp(config = readConfig(), dependencies = {}) {
  const sandbox = dependencies.sandbox || createSandbox(config);
  const inference = dependencies.inference || createInference(config);
  const jobs = createJobs(config, sandbox, inference);
  const sessions = new Map(), datasets = new Map();
  let readyCache, readyAt = 0;
  async function readiness() {
    if (!readyCache || Date.now() - readyAt > 10_000) {
      const [execution, ai] = await Promise.all([sandbox.ready(), inference.ready ? inference.ready() : Promise.resolve({ ready: Boolean(config.apiKey && config.model) })]);
      readyCache = { ...execution, ai }; readyAt = Date.now();
    }
    const inferenceReady = readyCache.ai.ready;
    return { ready: readyCache.ready && inferenceReady && !jobs.blocked, sandboxReady: readyCache.ready, inferenceReady, reason: jobs.blocked ? 'Sandbox cleanup needs attention.' : !readyCache.ready ? readyCache.reason : !inferenceReady ? readyCache.ai.reason : '', provider: config.provider, model: config.model || null, limits: { seconds: config.timeout, memoryMB: 256, maxUploadMB: 2, retentionMinutes: config.ttlMs / 60_000 }, running: jobs.running };
  }
  function session(req, res) {
    const token = /(?:^|;\s*)proofcsv_session=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    let current = sessions.get(token);
    if (current && Date.now() - current.lastSeen > config.ttlMs) { sessions.delete(token); current = null; }
    if (current) { current.lastSeen = Date.now(); return current; }
    if (sessions.size >= 200) throw new HttpError(503, 'The service is busy. Try again shortly.');
    const id = randomBytes(24).toString('hex');
    current = { id, lastSeen: Date.now(), uploads: [], runs: [] }; sessions.set(id, current);
    res.setHeader('Set-Cookie', `proofcsv_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(config.ttlMs / 1000)}${config.secureCookie ? '; Secure' : ''}`);
    return current;
  }
  function rate(current, field, max) {
    current[field] = current[field].filter(time => Date.now() - time < 3_600_000);
    if (current[field].length >= max) throw new HttpError(429, 'Your hourly limit has been reached. Please try again later.');
    current[field].push(Date.now());
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send a JSON request.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > config.maxBodyBytes) throw new HttpError(413, 'The request is too large. Upload a CSV under 2 MB.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON request.'); }
  }
  function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && STATIC.has(url.pathname)) {
        const [filename, type] = STATIC.get(url.pathname);
        const content = await readFile(new URL(`../public/${filename}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); res.end(content); return;
      }
      if (req.method === 'GET' && url.pathname === '/healthz') { json(res, 200, { status: 'ok' }); return; }
      if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Page not found.');
      if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        const localAlias = config.origin === 'http://localhost:3000' && origin === 'http://127.0.0.1:3000';
        if ((origin && origin !== config.origin && !localAlias) || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
      }
      const current = session(req, res);
      if (req.method === 'GET' && url.pathname === '/api/status') { json(res, 200, await readiness()); return; }
      if (req.method === 'GET' && url.pathname === '/api/sample') { json(res, 200, await sampleData()); return; }
      if (req.method === 'POST' && url.pathname === '/api/datasets') {
        rate(current, 'uploads', 12);
        const input = await body(req);
        if (!input || typeof input.csv !== 'string' || typeof input.filename !== 'string') throw new HttpError(400, 'Choose a CSV file first.');
        if (Buffer.byteLength(input.csv) > config.maxCsvBytes) throw new HttpError(413, 'Upload a CSV under 2 MB.');
        if (!/\.csv$/i.test(input.filename) || input.filename.length > 120) throw new HttpError(400, 'Choose a file with the .csv extension.');
        if (datasets.size >= 24 || [...datasets.values()].filter(item => item.owner === current.id).length >= 4) throw new HttpError(429, 'The upload store is full. Older uploads expire automatically.');
        const profile = profileCsv(input.csv);
        const dataset = { id: randomUUID(), owner: current.id, filename: input.filename.replace(/[^a-zA-Z0-9._ -]/g, '_'), csv: input.csv, profile, created: Date.now() };
        datasets.set(dataset.id, dataset);
        json(res, 201, { id: dataset.id, filename: dataset.filename, profile }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        const input = await body(req);
        if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid task.');
        const kind = input.kind || 'analysis';
        const available = await readiness();
        if (!available.sandboxReady || jobs.blocked || (kind === 'analysis' && !available.inferenceReady)) throw new HttpError(503, available.reason || 'Execution is not available yet.');
        let dataset;
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (kind === 'analysis') {
          dataset = datasets.get(input.datasetId);
          if (!dataset || dataset.owner !== current.id || Date.now() - dataset.created > config.ttlMs) throw new HttpError(404, 'Upload your dataset again; it may have expired.');
          if (question.length < 5 || question.length > 1500) throw new HttpError(400, 'Write a question between 5 and 1,500 characters.');
        }
        rate(current, 'runs', 8);
        json(res, 202, jobs.start(current.id, dataset, question, kind)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') { json(res, 200, { jobs: jobs.list(current.id) }); return; }
      const match = /^\/api\/jobs\/([a-f0-9-]{36})(?:\/files\/([^/]+))?$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        if (!match[2]) { json(res, 200, jobs.get(current.id, match[1])); return; }
        const file = jobs.file(current.id, match[1], decodeURIComponent(match[2]));
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.bytes, 'Content-Disposition': `attachment; filename="${file.name}"` });
        res.end(file.buffer); return;
      }
      throw new HttpError(404, 'Request not found.');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  // WSL systemd services alone do not prevent the distribution becoming idle.
  // Keep Docker awake through long model calls without a persistent orphan process.
  let heartbeatBusy = false;
  const heartbeat = config.dockerTransport === 'wsl' ? setInterval(async () => {
    if (heartbeatBusy || !sandbox.keepAlive) return;
    heartbeatBusy = true;
    try { await sandbox.keepAlive(); } finally { heartbeatBusy = false; }
  }, 5000) : null;
  heartbeat?.unref();
  const sweep = setInterval(() => {
    jobs.sweep();
    for (const [id, dataset] of datasets) if (Date.now() - dataset.created > config.ttlMs) datasets.delete(id);
    for (const [id, current] of sessions) if (Date.now() - current.lastSeen > config.ttlMs) sessions.delete(id);
  }, 60_000);
  sweep.unref();
  server.on('close', () => { clearInterval(sweep); if (heartbeat) clearInterval(heartbeat); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = readConfig();
  const server = createApp(config);
  server.listen(config.port, config.host, () => console.log(`ProofCSV is available at http://${config.host}:${server.address().port}`));
  function shutdown() { server.close(); setTimeout(() => process.exit(0), 3 * config.modelTimeoutMs + 2 * (config.timeout + 30) * 1000 + 10_000).unref(); }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
