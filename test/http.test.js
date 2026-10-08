import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.js';
import { createApp } from '../server/index.js';

async function setup(context, ready = false) {
  const server = createApp(readConfig({ PORT: '0', VULTR_SERVERLESS_INFERENCE_API_KEY: ready ? 'test-key' : '', VULTR_MODEL: ready ? 'test-model' : '' }), {
    sandbox: { ready: async () => ({ ready, reason: 'Sandbox not connected.' }), execute: async () => { throw new Error('No execution in HTTP tests.'); } },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function client(base) {
  const response = await fetch(`${base}/api/status`);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return (path, data, extra = {}) => fetch(`${base}${path}`, { ...(data !== undefined ? { method: 'POST', body: JSON.stringify(data) } : {}), headers: { cookie, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra } });
}
test('public preview serves the page and blocks live execution without Docker and Vultr', async context => {
  const base = await setup(context);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /ProofCSV/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const request = await client(base), status = await (await request('/api/status')).json();
  assert.equal(status.ready, false);
  const sample = await (await request('/api/sample')).json(); assert.equal(sample.sample, true);
  const job = await request('/api/jobs', { kind: 'analysis', question: 'Find the total' }); assert.equal(job.status, 503);
});
test('CSV uploads are validated, private to each session, and do not permit cross-site writes', async context => {
  const base = await setup(context, true), owner = await client(base), stranger = await client(base);
  const upload = await owner('/api/datasets', { filename: 'test.csv', csv: 'amount\n3\n4\n' }); assert.equal(upload.status, 201);
  const dataset = await upload.json(); assert.equal(dataset.profile.rowCount, 2);
  const otherJob = await stranger('/api/jobs', { datasetId: dataset.id, question: 'Find the total' }); assert.equal(otherJob.status, 404);
  const csrf = await owner('/api/datasets', { filename: 'x.csv', csv: 'a\n1' }, { origin: 'https://hostile.example' }); assert.equal(csrf.status, 403);
  const malformed = await owner('/api/datasets', { filename: 'x.csv', csv: 'a,b\n1' }); assert.equal(malformed.status, 400);
  const extension = await owner('/api/datasets', { filename: 'x.html', csv: 'a\n1' }); assert.equal(extension.status, 400);
});
test('unlisted paths cannot read local files and nonexistent artifacts return 404', async context => {
  const base = await setup(context), request = await client(base);
  for (const path of ['/.env', '/server/config.js', '/data/sample-sales.csv', '/api/jobs/00000000-0000-0000-0000-000000000000/files/..%2F.env']) assert.equal((await request(path)).status, 404);
});
