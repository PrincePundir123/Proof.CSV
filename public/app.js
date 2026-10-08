const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { dataset: null, status: null, result: null, active: null, sample: null, reports: new Map(), busy: false, pollErrors: 0 };
let toastTimer, pollTimer;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  let body;
  try { body = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}
function view(name) {
  for (const section of ['workspace', 'reports', 'safety']) $(`#${section}-view`).hidden = section !== name;
  for (const button of $$('[data-view]')) {
    const active = button.dataset.view === name; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = { workspace: 'Overview', reports: 'My reports', safety: 'Safety lab' }[name];
  if (name === 'reports') void renderReports();
}
function output(name) {
  for (const section of ['empty', 'progress', 'result', 'error']) $(`#${section}-state`).hidden = section !== name;
}
function updateRunButton() {
  const usable = Boolean(state.status?.ready && state.dataset?.id && $('#question').value.trim().length >= 5 && !state.busy);
  $('#run-button').disabled = !usable;
  $('#run-button span').textContent = state.busy ? 'Analysis in progress…' : 'Run analysis';
  $('#run-note').textContent = state.busy ? state.status?.provider === 'local' ? 'Local analysis may take a few minutes. You can inspect each step as it runs.' : 'You can inspect each step while your task runs.' : !state.status?.ready ? 'Live execution is not connected. Explore a sample report above.' : !state.dataset?.id ? 'Choose a CSV and ask a question to begin.' : 'The code runs in a fresh, offline sandbox.';
  $('#test-timeout').disabled = !state.status?.sandboxReady || state.busy;
  $('#test-boundary').disabled = !state.status?.sandboxReady || state.busy;
}
async function refreshStatus(announce = false) {
  try {
    state.status = await api('/api/status');
    $('#service-status').replaceChildren(node('span', 'status-dot'), document.createTextNode(state.status.ready ? state.status.provider === 'local' ? 'Local AI ready' : 'Execution ready' : 'Preview mode'));
    $('#service-status').classList.toggle('connected', state.status.ready);
    $('#preview-notice').hidden = state.status.ready;
    $('#retention').textContent = state.status.limits.retentionMinutes;
    $('#about-provider').textContent = `${state.status.provider === 'local' ? 'Your local AI model' : 'Vultr Inference'} writes the plan and code. Execution errors can trigger one visible repair attempt.`;
    $('#safety-note').textContent = state.status.sandboxReady ? 'The execution service is connected. Both tests use a fresh disposable container.' : 'The sandbox is not connected yet. These tests stay disabled until it is ready.';
    if (announce) toast(state.status.ready ? 'The execution service is ready.' : state.status.reason, !state.status.ready);
  } catch (error) {
    state.status = { ready: false, sandboxReady: false };
    $('#service-status').textContent = 'Connection unavailable'; $('#preview-notice').hidden = false;
    if (announce) toast(error.message, true);
  }
  updateRunButton();
}
function renderDataset(dataset) {
  state.dataset = dataset;
  $('#file-error').hidden = true;
  $('#dataset-panel').hidden = !dataset;
  $('#dropzone').hidden = Boolean(dataset);
  $('#file-input').value = '';
  if (dataset) {
    $('#dataset-name').textContent = dataset.filename;
    $('#dataset-meta').textContent = `${dataset.profile.rowCount.toLocaleString()} rows · ${dataset.profile.columnCount} columns${dataset.id ? ' · Ready to analyze' : ' · Sample preview'}`;
    const table = $('#preview-table'); table.replaceChildren();
    const thead = node('thead'), header = node('tr');
    for (const column of dataset.profile.columns) { const th = node('th', '', column.name); th.scope = 'col'; header.append(th); }
    thead.append(header); const tbody = node('tbody');
    for (const row of dataset.profile.preview) { const tr = node('tr'); for (const cell of row) tr.append(node('td', '', cell)); tbody.append(tr); }
    table.append(thead, tbody);
  }
  updateRunButton();
}
function uploadError(message) {
  $('#file-error').textContent = message;
  $('#file-error').hidden = false;
  toast(message, true);
}
async function upload(file) {
  if (!file) return;
  $('#file-error').hidden = true;
  if (!/\.csv$/i.test(file.name)) return uploadError('Choose a CSV (.csv) file. For Excel files, use Save As → CSV first. You can also download the example CSV below.');
  if (file.size > 2 * 1024 * 1024) return uploadError('Choose a CSV under 2 MB.');
  try {
    $('#use-sample').disabled = true;
    const dataset = await api('/api/datasets', { method: 'POST', body: JSON.stringify({ filename: file.name, csv: await file.text() }) });
    renderDataset(dataset); toast(`${dataset.filename} is ready.`);
  } catch (error) { uploadError(error.message); }
  finally { $('#use-sample').disabled = false; }
}
async function loadSample(report = false) {
  try {
    state.sample ||= await api('/api/sample');
    // Upload the sample through the same validation path as a user's file.
    if (state.status?.ready) {
      const dataset = await api('/api/datasets', { method: 'POST', body: JSON.stringify({ filename: state.sample.filename, csv: state.sample.csv }) });
      renderDataset(dataset);
    } else renderDataset(state.sample);
    $('#question').value = 'Show monthly revenue as a chart and explain the biggest changes.';
    updateRunButton();
    if (report || !state.status?.ready) {
      const sample = { ...state.sample, id: 'sample', status: 'sample', title: state.sample.report.title, filename: state.sample.filename, created: Date.now(), events: [], attempts: [], files: [], explanation: state.sample.report.summary };
      state.reports.set('sample', sample); showResult(sample); updateCount(); view('workspace');
    } else toast('Sample data loaded. You can now run a real analysis.');
  } catch (error) { toast(error.message, true); }
}
function updateCount() { $('#report-count').textContent = state.reports.size; }
function chart(series) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 460 205'); svg.classList.add('chart-svg'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', series.map(item => `${item.label}: ${item.value}`).join('; '));
  function element(tag, attributes, content) {
    const child = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) child.setAttribute(key, value);
    if (content !== undefined) child.textContent = content;
    svg.append(child); return child;
  }
  const max = Math.max(...series.map(item => item.value), 1), min = Math.min(...series.map(item => item.value), 0);
  const range = max - min, y = value => 163 - (value - min) / range * 140;
  for (let line = 0; line <= 3; line++) {
    const value = min + range * line / 3, coordinate = y(value);
    element('line', { x1: 45, x2: 450, y1: coordinate, y2: coordinate, class: 'chart-grid' });
    element('text', { x: 37, y: coordinate + 3, 'text-anchor': 'end' }, Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(0)}k` : value.toFixed(0));
  }
  const gap = 400 / series.length, width = Math.min(37, gap * .57), baseline = y(0);
  for (let i = 0; i < series.length; i++) {
    const item = series[i], x = 48 + i * gap + (gap - width) / 2, top = Math.min(y(item.value), baseline);
    const bar = element('rect', { x, y: top, width, height: Math.max(1, Math.abs(baseline - y(item.value))), rx: 3, class: 'bar' });
    const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `${item.label}: ${item.value.toLocaleString()}`; bar.append(title);
    const label = /^\d{4}-\d{2}$/.test(item.label) ? new Date(`${item.label}-15T12:00:00Z`).toLocaleString('en', { month: 'short', timeZone: 'UTC' }) : item.label.slice(0, 10);
    element('text', { x: x + width / 2, y: 188, 'text-anchor': 'middle' }, label);
  }
  return svg;
}
function eventList(events) {
  const list = node('ol', 'event-list');
  for (const event of events) {
    const li = node('li', '', event.message);
    if (event.time) { const time = node('time', '', new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })); time.dateTime = event.time; li.append(time); }
    list.append(li);
  }
  return list;
}
function artifactLink(file) {
  const link = node('a', 'artifact'); link.href = file.url; link.download = file.name; link.append(icon('download'), document.createTextNode(file.name)); return link;
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = node('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showResult(result) {
  state.result = result; output('result');
  const sample = result.status === 'sample', report = result.report;
  $('#result-badge').textContent = sample ? 'Sample preview' : result.status === 'contained' ? 'Containment verified' : `Executed · ${result.attempts.length} attempt${result.attempts.length === 1 ? '' : 's'}`;
  $('#result-badge').classList.toggle('success', !sample);
  $('#report-title').textContent = report.title;
  $('#report-summary').textContent = result.explanation || report.summary;
  $('#metrics').replaceChildren();
  for (const metric of report.metrics || []) {
    const block = node('div', 'metric');
    block.append(node('span', 'metric-label', metric.label), node('strong', 'metric-value', metric.value), node('span', 'metric-detail', metric.detail));
    $('#metrics').append(block);
  }
  const image = result.files?.find(file => file.type === 'image/png' || file.type === 'image/jpeg');
  $('#chart').replaceChildren(); $('#chart-container').hidden = !image && !report.series?.length;
  $('#chart-title').textContent = report.chartTitle || 'Executed chart';
  $('#chart-unit').textContent = sample ? 'Sample data · INR' : 'From your executed result';
  if (image) { const img = node('img', 'chart-image'); img.src = image.url; img.alt = report.chartTitle || 'Chart generated by the executed analysis'; $('#chart').append(img); }
  else if (report.series?.length) $('#chart').append(chart(report.series));
  $('#findings').replaceChildren(...(report.findings || []).map(finding => node('li', '', finding)));
  $('#artifacts').replaceChildren();
  if (sample) {
    const button = node('button', 'artifact'); button.append(icon('download'), document.createTextNode('sample-sales.csv'));
    button.addEventListener('click', () => download('sample-sales.csv', state.sample.csv, 'text/csv')); $('#artifacts').append(button);
    const reportButton = node('button', 'artifact'); reportButton.append(icon('download'), document.createTextNode('sample-report.json'));
    reportButton.addEventListener('click', () => download('sample-report.json', JSON.stringify({ sample: true, executionPerformed: false, ...report }, null, 2))); $('#artifacts').append(reportButton);
  } else for (const file of result.files) $('#artifacts').append(artifactLink(file));
  $('#code-label').textContent = sample ? 'Example code · not executed' : 'Executed code';
  $('#result-code').textContent = result.code;
  $('#evidence-content').replaceChildren();
  if (sample) {
    $('#evidence-content').append(node('p', 'evidence-facts', 'SAMPLE PREVIEW\nComputed from the bundled CSV by the server. No AI call, container, execution log, or verified sandbox run is represented here.'));
  } else {
    $('#evidence-content').append(eventList(result.events));
    for (const attempt of result.attempts) {
      const evidence = attempt.evidence;
      $('#evidence-content').append(node('p', 'evidence-facts', `ATTEMPT ${attempt.number} · exit ${attempt.exitCode}\nContainer: ${evidence.container}\nTime limit: ${evidence.seconds}s · Memory: ${evidence.memoryMB} MB\nNetwork: ${evidence.network} · Host mounts: ${evidence.hostMounts}\nCredentials provided: ${evidence.secretsProvided}\nContainer destroyed: ${evidence.destroyed}\nCode SHA-256: ${evidence.codeSha256}`));
      if (attempt.stdout) { $('#evidence-content').append(node('pre', '', attempt.stdout)); }
      if (attempt.stderr) { const detail = node('details'), summary = node('summary', '', `Attempt ${attempt.number} error log`); detail.append(summary, node('pre', '', attempt.stderr)); $('#evidence-content').append(detail); }
    }
    for (const file of result.files) $('#evidence-content').append(node('p', 'evidence-facts', `${file.name} · ${file.bytes.toLocaleString()} bytes\nSHA-256: ${file.sha256}`));
  }
  $('#download-evidence').textContent = sample ? 'Download sample report' : 'Download execution record';
}
function showProgress(job) {
  output('progress'); $('#result-badge').textContent = 'Working'; $('#result-badge').classList.remove('success');
  $('#progress-title').textContent = { queued: 'Your task is ready to start', planning: 'Planning your analysis', repairing: 'Reading the error. Trying again.', executing: 'Doing the actual work', verifying: 'Checking your results' }[job.status] || 'Working on your task';
  $('#progress-description').textContent = job.events.at(-1)?.message || 'Your task is being prepared.';
  $('#progress-events').replaceChildren(...eventList(job.events).children);
}
function showError(job) {
  output('error'); $('#result-badge').textContent = 'Needs attention'; $('#result-badge').classList.remove('success');
  $('#error-message').textContent = job.error;
  $('#error-attempts').replaceChildren();
  for (const attempt of job.attempts || []) {
    const details = node('details'), summary = node('summary', '', `Attempt ${attempt.number} · view execution log`);
    details.append(summary, node('pre', '', [attempt.validationError, attempt.stderr, attempt.stdout].filter(Boolean).join('\n\n'))); $('#error-attempts').append(details);
  }
}
async function poll(id) {
  try {
    const job = await api(`/api/jobs/${id}`); state.pollErrors = 0; state.reports.set(id, job); updateCount();
    if (['completed', 'contained', 'failed'].includes(job.status)) {
      state.busy = false; state.active = null; updateRunButton();
      if (job.status === 'failed') showError(job); else showResult(job);
      return;
    }
    showProgress(job); pollTimer = setTimeout(() => void poll(id), 1000);
  } catch (error) {
    state.pollErrors++;
    if (state.pollErrors < 6) { toast('Reconnecting to your task…'); pollTimer = setTimeout(() => void poll(id), 3000); }
    else { state.busy = false; state.active = null; updateRunButton(); showError({ error: 'The connection was interrupted. Open My reports to reconnect to your task.', attempts: [] }); }
  }
}
async function run(kind = 'analysis') {
  if (state.busy) return;
  try {
    state.busy = true; updateRunButton();
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ kind, datasetId: state.dataset?.id, question: $('#question').value.trim() }) });
    state.active = job.id; state.reports.set(job.id, job); updateCount(); view('workspace'); showProgress(job); void poll(job.id);
  } catch (error) { state.busy = false; updateRunButton(); toast(error.message, true); }
}
async function renderReports() {
  try {
    const response = await api('/api/jobs');
    const sample = state.reports.get('sample');
    state.reports = new Map(sample ? [['sample', sample]] : []);
    for (const job of response.jobs) state.reports.set(job.id, job);
  }
  catch (error) { toast(error.message, true); }
  updateCount(); const list = $('#report-list'); list.replaceChildren();
  if (!state.reports.size) {
    const empty = node('div', 'report-empty'); empty.append(icon('file'), node('h3', '', 'A clean slate.'), node('p', '', 'Your analyses will appear here. Start with your data or explore the sample.'));
    const button = node('button', 'secondary-button', 'Explore a sample report →'); button.addEventListener('click', () => void loadSample(true)); empty.append(button); list.append(empty); return;
  }
  for (const report of [...state.reports.values()].reverse()) {
    const row = node('article', 'report-row'), details = node('div');
    details.append(node('h3', '', report.title), node('p', '', `${report.filename} · ${report.status === 'sample' ? 'Sample preview' : new Date(report.created).toLocaleString()}`));
    const badge = node('span', 'result-badge', report.status), button = node('button', 'text-button', 'Open report →');
    button.addEventListener('click', () => {
      view('workspace');
      if (report.status === 'sample' || ['completed', 'contained'].includes(report.status)) showResult(report);
      else if (report.status === 'failed') showError(report);
      else { clearTimeout(pollTimer); state.busy = true; state.active = report.id; updateRunButton(); showProgress(report); void poll(report.id); }
    });
    row.append(icon('file'), details, badge, button); list.append(row);
  }
}

for (const button of $$('[data-view]')) button.addEventListener('click', () => view(button.dataset.view));
for (const button of $$('[data-prompt]')) button.addEventListener('click', () => { $('#question').value = button.dataset.prompt; $('#question').focus(); updateRunButton(); });
$('#question').addEventListener('input', updateRunButton);
function browseFiles() {
  $('#file-input').value = '';
  $('#file-input').click();
}
$('#file-input').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  void upload(file);
});
$('#dropzone').addEventListener('click', browseFiles);
$('#change-file').addEventListener('click', browseFiles);
$('#dropzone').addEventListener('dragover', event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); void upload(event.dataTransfer.files[0]); });
$('#remove-dataset').addEventListener('click', () => renderDataset(null));
$('#use-sample').addEventListener('click', () => void loadSample());
$('#download-sample').addEventListener('click', async () => {
  $('#download-sample').disabled = true;
  try {
    state.sample ||= await api('/api/sample');
    download('sample-sales.csv', state.sample.csv, 'text/csv');
  } catch (error) { toast(error.message, true); }
  finally { $('#download-sample').disabled = false; }
});
for (const id of ['sample-report-button', 'empty-sample-button']) $(`#${id}`).addEventListener('click', () => void loadSample(true));
$('#run-button').addEventListener('click', () => void run());
$('#test-timeout').addEventListener('click', () => void run('timeout'));
$('#test-boundary').addEventListener('click', () => void run('boundary'));
$('#refresh-status').addEventListener('click', () => void refreshStatus(true));
$('#try-again').addEventListener('click', () => { output('empty'); $('#result-badge').textContent = 'Ready when you are'; $('#question').focus(); });
for (const id of ['how-button', 'help-button']) $(`#${id}`).addEventListener('click', () => $('#about-dialog').showModal());
$('#close-dialog').addEventListener('click', () => $('#about-dialog').close());
$('#about-dialog').addEventListener('click', event => { if (event.target === $('#about-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('#copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#result-code').textContent); toast('Code copied.'); }
  catch { download('analysis.py', $('#result-code').textContent, 'text/plain'); toast('Code downloaded.'); }
});
$('#download-evidence').addEventListener('click', () => {
  if (!state.result) return;
  const { csv, profile, ...record } = state.result;
  download(state.result.status === 'sample' ? 'sample-report.json' : `execution-${state.result.id}.json`, JSON.stringify({ ...record, executionPerformed: state.result.status !== 'sample' }, null, 2));
});
await refreshStatus();
try {
  const response = await api('/api/jobs'); for (const job of response.jobs) state.reports.set(job.id, job); updateCount();
  const active = response.jobs.find(job => !['completed', 'contained', 'failed'].includes(job.status));
  if (active) { state.busy = true; state.active = active.id; updateRunButton(); showProgress(active); void poll(active.id); }
} catch { /* The workspace remains usable if history is temporarily unavailable. */ }
