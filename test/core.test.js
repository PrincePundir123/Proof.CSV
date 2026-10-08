import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readConfig } from '../server/config.js';
import { parseCsv, profileCsv } from '../server/csv.js';
import { createInference, parsePlan } from '../server/inference.js';
import { createSandbox, sandboxArgs, validateArtifacts } from '../server/sandbox.js';
import { createJobs, normalizeReport } from '../server/jobs.js';
import { sampleData } from '../server/sample.js';

const config = readConfig({ VULTR_SERVERLESS_INFERENCE_API_KEY: 'test-only-key', VULTR_MODEL: 'test-model' });
const report = { title: 'Actual total', summary: 'Computed two rows.', metrics: [{ label: 'Total', value: '7' }], findings: ['Total is 7.'] };
function file(name = 'report.json', content = JSON.stringify(report)) {
  const buffer = Buffer.from(content);
  return { name, buffer, bytes: buffer.length, type: 'application/json', sha256: createHash('sha256').update(buffer).digest('hex') };
}
async function finish(jobs, id) {
  for (let i = 0; i < 100; i++) { const job = jobs.get('owner', id); if (['completed', 'contained', 'failed'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Job did not finish.');
}

test('CSV supports quotes, embedded newlines, CRLF, BOM, and escaped quotes', () => {
  const parsed = parseCsv('\uFEFFname,note,value\r\n"Alice","a,b",3\r\n"Bob","a\n""quote""",4\r\n');
  assert.deepEqual(parsed.rows, [['Alice', 'a,b', '3'], ['Bob', 'a\n"quote"', '4']]);
  const profile = profileCsv('a,b\n1,\n2,hello\n');
  assert.equal(profile.columns[0].type, 'number'); assert.equal(profile.columns[1].missing, 1);
});
test('CSV rejects ambiguous headers, malformed quoting, mismatched rows and excessive rows', () => {
  for (const csv of ['a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a\n"missing', 'a\n"ok"junk', 'a\nhello"world']) assert.throws(() => parseCsv(csv));
  assert.throws(() => parseCsv('a\n1\n2', 1));
});
test('model output is validated before any execution', () => {
  assert.equal(parsePlan('```json\n{"title":"Test","plan":["Compute"],"code":"print(7)"}\n```').code, 'print(7)');
  for (const value of ['not json', '{"plan":[],"code":"x"}', '{"plan":[3],"code":"x"}', '{"plan":["x"],"code":""}']) assert.throws(() => parsePlan(value));
});
test('inference uses only the fixed Vultr endpoint and enforces an actual call budget', async () => {
  let calls = 0;
  const service = createInference({ ...config, dailyCalls: 1 }, async (url, options) => {
    calls++; assert.equal(url, 'https://api.vultrinference.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); assert.equal(body.model, 'test-model');
    assert.match(body.messages[0].content, /untrusted data/);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"Test","plan":["Compute"],"code":"print(7)"}' } }] }));
  });
  await service.plan('Find the total', { rows: [] });
  await assert.rejects(service.plan('Again', {}), /budget/); assert.equal(calls, 1);
});
test('inference provider errors never expose a response body or API key', async () => {
  const service = createInference(config, async () => new Response('secret-provider-details', { status: 401 }));
  await assert.rejects(service.plan('Find total', {}), error => !error.message.includes('secret-provider-details') && !error.message.includes(config.apiKey));
});
test('local AI requires loopback app and model addresses', () => {
  const local = { MODEL_PROVIDER: 'local' };
  assert.equal(readConfig(local).inferenceUrl, 'http://127.0.0.1:11434/v1/chat/completions');
  for (const invalid of [{ HOST: '0.0.0.0' }, { PUBLIC_ORIGIN: 'https://example.com' }, { LOCAL_MODEL_URL: 'http://example.com/v1' }]) assert.throws(() => readConfig({ ...local, ...invalid }), /loopback/);
});
test('local inference checks the loaded model, uses structured code, and sends no cloud key', async () => {
  const local = readConfig({ MODEL_PROVIDER: 'local', VULTR_SERVERLESS_INFERENCE_API_KEY: 'must-stay-private' });
  const service = createInference(local, async (url, options) => {
    assert.equal(options.headers?.Authorization, undefined);
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'proofcsv-local' }] });
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.type, 'json_object');
    assert.deepEqual(body.response_format.schema.required, ['title', 'plan', 'code']);
    assert.equal(body.response_format.schema.properties.plan.type, 'array');
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.ok(body.max_tokens > 0);
    assert.ok(!options.body.includes('must-stay-private'));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: 'Total', plan: ['Add values'], code: 'print(7)' }) } }] });
  });
  assert.equal((await service.ready()).ready, true);
  assert.equal((await service.plan('Add the values', {})).code, 'print(7)');
  const missing = createInference(local, async () => Response.json({ data: [{ id: 'wrong-model' }] }));
  assert.equal((await missing.ready()).ready, false);
});
test('sandbox commands have no host mounts, privileged flag, shell, or inference credential', () => {
  const args = sandboxArgs(config, 'proofcsv-test', 20);
  for (const required of ['--read-only', '--cap-drop', '--pids-limit', '--memory', '--memory-swap', '--cpus', '--security-opt', '--network', '--user']) assert.ok(args.includes(required));
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.ok(!args.some(arg => /test-only-key|--privileged|--mount|--volume|docker.sock/.test(arg)));
});
test('artifact verification rejects traversal, unsupported content, wrong hashes, and forged image types', () => {
  const artifact = file();
  const encoded = { name: artifact.name, data: artifact.buffer.toString('base64'), sha256: artifact.sha256 };
  assert.equal(validateArtifacts([encoded])[0].bytes, artifact.bytes);
  for (const invalid of [{ ...encoded, name: '../report.json' }, { ...encoded, name: 'x.html' }, { ...encoded, sha256: 'wrong' }, { ...encoded, name: 'forged.png' }, { ...encoded, data: '!!!!' }]) assert.throws(() => validateArtifacts([invalid]));
  assert.throws(() => validateArtifacts([encoded, encoded]));
});
test('sandbox cleanup runs on invalid execution output and removal is independently checked', async () => {
  const calls = [];
  const sandbox = createSandbox(config, async (binary, args) => {
    calls.push(args);
    if (args[0] === 'create') return { code: 0, stdout: 'container', stderr: '' };
    if (args[0] === 'start') return { code: 0, stdout: 'invalid protocol', stderr: '' };
    if (args[0] === 'rm') return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'Error: No such container: proofcsv-test' };
  });
  await assert.rejects(sandbox.execute('print(7)', 'a\n1'), /invalid execution record/);
  assert.ok(calls.some(args => args[0] === 'rm')); assert.ok(calls.some(args => args[0] === 'container'));
});
test('Docker readiness fails closed when the daemon cannot enforce resource limits', async () => {
  const sandbox = createSandbox(config, async () => ({ code: 0, stdout: JSON.stringify({ MemoryLimit: false, PidsLimit: true, CpuCfsQuota: true }), stderr: '' }));
  assert.equal((await sandbox.ready()).ready, false);
});
test('WSL Docker readiness uses the daemon resource fields and avoids a shell', async () => {
  const sandbox = createSandbox({ ...config, dockerTransport: 'wsl' }, async (binary, args) => {
    assert.equal(binary, 'wsl.exe');
    assert.deepEqual(args.slice(0, 6), ['-d', 'Ubuntu', '-u', 'root', '--', 'docker']);
    return { code: 0, stdout: args[6] === 'info' ? JSON.stringify({ MemoryLimit: true, PidsLimit: true, CpuCfsQuota: true }) : '[]', stderr: '' };
  });
  assert.equal((await sandbox.ready()).ready, true);
  assert.equal(await sandbox.keepAlive(), true);
});
test('failed code triggers one repair with its actual error; the successful output is returned', async () => {
  let executions = 0, plans = 0;
  const sandbox = { execute: async () => {
    executions++;
    return { exitCode: executions === 1 ? 1 : 0, timedOut: false, stdout: executions === 1 ? '' : 'Total 7', stderr: executions === 1 ? 'KeyError: amount' : '', files: executions === 1 ? [] : [file()], evidence: { destroyed: true } };
  } };
  const inference = { plan: async (question, profile, previous) => { plans++; if (plans === 2) assert.equal(previous.stderr, 'KeyError: amount'); return { title: 'Total', plan: ['Compute'], code: `print(${plans})` }; }, explain: async () => 'The executed total is 7.' };
  const jobs = createJobs(config, sandbox, inference), job = jobs.start('owner', { csv: 'amount\n3\n4', profile: {}, filename: 'test.csv' }, 'Calculate the total');
  const done = await finish(jobs, job.id);
  assert.equal(done.status, 'completed'); assert.equal(done.attempts.length, 2); assert.equal(done.report.metrics[0].value, '7'); assert.equal(executions, 2);
  assert.throws(() => jobs.get('someone-else', job.id), /not found/);
  assert.ok(!Object.hasOwn(done.files[0], 'buffer'));
});
test('unverified cleanup stops future execution rather than silently proceeding', async () => {
  const sandbox = { execute: async () => { throw new Error('Sandbox cleanup could not be verified.'); } };
  const inference = { plan: async () => ({ title: 'Test', plan: ['Compute'], code: 'print(7)' }) };
  const jobs = createJobs(config, sandbox, inference);
  const job = jobs.start('owner', { csv: 'a\n1', profile: {} }, 'Find total');
  assert.equal((await finish(jobs, job.id)).status, 'failed'); assert.equal(jobs.blocked, true);
  assert.throws(() => jobs.start('owner', {}, 'Another task'), /cleanup/);
});
test('report normalization drops invalid metric values and nonfinite chart values', () => {
  const result = normalizeReport({ ...report, metrics: [{ label: 'x', value: {} }], series: [{ label: 'bad', value: Infinity }, { label: 'ok', value: 2 }] });
  assert.equal(result.metrics[0].value, ''); assert.deepEqual(result.series, [{ label: 'ok', value: 2 }]);
});
test('the sample preview totals are derived from its dataset and explicitly marked as a sample', async () => {
  const sample = await sampleData();
  assert.equal(sample.sample, true); assert.equal(sample.profile.rowCount, 36);
  assert.equal(sample.report.series.reduce((sum, row) => sum + row.value, 0), 110_940);
  assert.match(sample.report.findings.at(-1), /No AI call or sandbox execution/);
});
