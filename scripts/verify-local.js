import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { parseCsv } from '../server/csv.js';

// Uses the real localhost app, model and Docker. No network/API fixtures.
const origin = 'http://127.0.0.1:3000';
const output = resolve('runtime/local-verification');
await mkdir(output, { recursive: true });
const browser = await chromium.launch(process.platform === 'win32' ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin);
  await page.locator('#service-status.connected').waitFor({ timeout: 30_000 });
  assert.match(await page.locator('#service-status').innerText(), /Local AI ready/);
  await page.locator('#file-input').setInputFiles(resolve('data/sample-sales.csv'));
  await page.locator('#dataset-panel:not([hidden])').waitFor();
  const jobResponse = page.waitForResponse(response => response.url().endsWith('/api/jobs') && response.request().method() === 'POST');
  await page.locator('#question').fill('Calculate total revenue and monthly revenue using the date and revenue columns. Create a monthly revenue PNG chart and monthly CSV with YYYY-MM month labels and revenue totals. Report total revenue and first-to-last month growth percentage. Use the actual data.');
  await page.locator('#run-button').click();
  const job = await (await jobResponse).json();
  assert.ok(job.id, JSON.stringify(job));
  console.log(`Real AI analysis started: ${job.id}`);

  async function finished(id) {
    let last = '', lastLog = 0;
    for (let attempt = 0; attempt < 360; attempt++) {
      const response = await page.request.get(`${origin}/api/jobs/${id}`);
      assert.equal(response.status(), 200);
      const result = await response.json();
      if (result.status !== last || Date.now() - lastLog > 30_000) { console.log(`${result.kind}: ${result.status}`); last = result.status; lastLog = Date.now(); }
      if (['completed', 'contained', 'failed'].includes(result.status)) {
        await writeFile(resolve(output, `${result.kind}-${id}.json`), JSON.stringify(result, null, 2));
        assert.notEqual(result.status, 'failed', result.error);
        assert.ok(result.attempts.every(attempt => attempt.evidence.destroyed));
        return result;
      }
      await new Promise(done => setTimeout(done, 2000));
    }
    throw new Error('The real job did not complete within 12 minutes.');
  }

  async function artifacts(result) {
    const downloaded = new Map();
    for (const file of result.files) {
      const response = await page.request.get(`${origin}${file.url}`);
      assert.equal(response.status(), 200);
      const bytes = await response.body();
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      await writeFile(resolve(output, `${result.id}-${file.name}`), bytes);
      downloaded.set(file.name, bytes);
    }
    return downloaded;
  }

  const analysis = await finished(job.id);
  const files = await artifacts(analysis);
  assert.ok([...files.keys()].some(name => name.endsWith('.png')));
  const monthlyFile = [...files.entries()].find(([name]) => name.endsWith('.csv'));
  assert.ok(monthlyFile, 'The generated monthly CSV must exist.');
  const monthlyCsv = parseCsv(monthlyFile[1].toString('utf8'));
  const valueColumn = monthlyCsv.headers.findIndex(header => /revenue/i.test(header));
  const labelColumn = monthlyCsv.headers.findIndex(header => /month|date/i.test(header));
  assert.ok(valueColumn >= 0 && labelColumn >= 0, 'The exported CSV needs month and revenue columns.');
  const monthly = monthlyCsv.rows.map(row => Number(row[valueColumn]));
  assert.deepEqual(monthly, [12450, 15880, 14920, 18760, 22140, 26790]);
  assert.deepEqual(monthlyCsv.rows.map(row => row[labelColumn]), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.equal(monthly.reduce((sum, value) => sum + value, 0), 110940);
  assert.ok(analysis.report.metrics.some(metric => Number(metric.value.replace(/[^0-9.-]/g, '')) === 110940), 'The reported total must match the exported data.');
  await page.locator('#result-badge.success').waitFor({ timeout: 10_000 });
  await page.locator('#chart img').waitFor();
  await page.waitForFunction(() => document.querySelector('#chart img')?.naturalWidth > 0);
  await page.screenshot({ path: resolve(output, 'real-analysis.png'), fullPage: true });
  console.log('Actual monthly values, total, PNG, CSV, hashes and cleanup passed.');

  const upload = await page.request.post(`${origin}/api/datasets`, { headers: { Origin: origin }, data: { filename: 'cleaning-check.csv', csv: 'name,amount\n Alice ,10\nBob,20\n Alice ,10\nCara,\n' } });
  assert.equal(upload.status(), 201);
  const dataset = await upload.json();
  const request = await page.request.post(`${origin}/api/jobs`, { headers: { Origin: origin }, data: { datasetId: dataset.id, question: 'Clean this CSV: trim leading and trailing whitespace from name, remove exact duplicate rows after trimming, preserve missing amounts without filling or dropping them. Save cleaned.csv. Report original and cleaned row counts, duplicates removed and missing values.' } });
  assert.equal(request.status(), 202);
  const cleaning = await finished((await request.json()).id);
  const cleanedFiles = await artifacts(cleaning);
  const cleaned = parseCsv(cleanedFiles.get('cleaned.csv')?.toString('utf8') || '');
  assert.deepEqual(cleaned.headers, ['name', 'amount']);
  assert.deepEqual(cleaned.rows.map(row => row[0]), ['Alice', 'Bob', 'Cara']);
  assert.equal(Number(cleaned.rows[0][1]), 10); assert.equal(Number(cleaned.rows[1][1]), 20); assert.equal(cleaned.rows[2][1], '');
  console.log('Actual CSV cleaning preserves missing values, trims names and removes duplicates.');

  for (const kind of ['timeout', 'boundary']) {
    const response = await page.request.post(`${origin}/api/jobs`, { headers: { Origin: origin }, data: { kind } });
    assert.equal(response.status(), 202);
    const result = await finished((await response.json()).id);
    assert.equal(result.status, 'contained');
    if (kind === 'timeout') assert.equal(result.attempts[0].timedOut, true);
    await artifacts(result);
  }
  assert.deepEqual(errors, []);
  console.log('Complete localhost verification passed: real AI analysis, cleaning, downloads and Safety Lab.');
} finally { await browser.close(); }
