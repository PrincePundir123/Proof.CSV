import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('sample report, code, download, reports navigation, and explanation are usable', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#service-status')).toContainText('Preview mode');
  await expect(page.locator('#run-button')).toBeDisabled();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Explore a sample report', exact: true }).click();
  await expect(page.locator('#result-badge')).toHaveText('Sample preview');
  await expect(page.locator('#metrics')).toContainText('₹1,10,940');
  await expect(page.locator('#metrics')).toContainText('+115.2%');
  await expect(page.locator('#findings')).toContainText('No AI call or sandbox execution took place.');
  await page.locator('.code-details summary').click();
  await expect(page.locator('#result-code')).toContainText('pd.read_csv');
  await expect(page.locator('#code-label')).toContainText('not executed');
  await page.locator('.code-details summary').click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'sample-sales.csv', exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('sample-sales.csv');
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'test-results/sample-report-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /My reports/ }).click();
  await expect(page.locator('#report-list')).toContainText('Sample preview');
  await page.getByRole('button', { name: 'Open report →' }).click();
  await expect(page.locator('#report-title')).toHaveText('A stronger finish to the first half');
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close explanation' }).click();
  expect(errors).toEqual([]);
});

test('browse opens the file picker and a sample can be replaced with a laptop file', async ({ page }) => {
  await mkdir('test-results', { recursive: true });
  const filePath = resolve('test-results/laptop-data.csv');
  await writeFile(filePath, 'name,amount\nAlice,10\nBob,20\n');
  await page.goto('/');
  // No accept filter: Windows should list files instead of hiding non-CSV files.
  expect(await page.locator('#file-input').getAttribute('accept')).toBeNull();
  const firstChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse CSV files' }).click();
  await (await firstChooser).setFiles(filePath);
  await expect(page.locator('#dataset-name')).toHaveText('laptop-data.csv');
  await expect(page.locator('#dataset-meta')).toContainText('2 rows');
  await page.getByRole('button', { name: 'Try our sample data' }).click();
  await expect(page.locator('#dataset-name')).toHaveText('sample-sales.csv');
  const replacementChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose another file' }).click();
  await (await replacementChooser).setFiles(filePath);
  await expect(page.locator('#dataset-name')).toHaveText('laptop-data.csv');
  await page.locator('.data-preview summary').click();
  await expect(page.getByRole('cell', { name: 'Alice' })).toBeVisible();
  const cancelChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose another file' }).click();
  await (await cancelChooser).setFiles([]);
  await expect(page.locator('#dataset-name')).toHaveText('laptop-data.csv');
});

test('keyboard browsing can reselect a corrected file and explains unsupported Excel files', async ({ page }) => {
  await mkdir('test-results', { recursive: true });
  const filePath = resolve('test-results/corrected-data.csv');
  await writeFile(filePath, 'name,amount\nAlice\n');
  await page.goto('/');
  const browse = page.getByRole('button', { name: 'Browse CSV files' });
  await browse.focus();
  const invalidChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await invalidChooser).setFiles(filePath);
  await expect(page.locator('#toast')).toContainText('same number of columns');
  await expect(page.locator('#dataset-panel')).toBeHidden();
  await writeFile(filePath, 'name,amount\nAlice,10\n');
  await browse.focus();
  const correctedChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  await (await correctedChooser).setFiles(filePath);
  await expect(page.locator('#dataset-name')).toHaveText('corrected-data.csv');
  const excelChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose another file' }).click();
  await (await excelChooser).setFiles({ name: 'workbook.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a CSV') });
  await expect(page.locator('#toast')).toContainText('use Save As → CSV first');
  await expect(page.getByRole('alert')).toContainText('download the example CSV');
  await expect(page.locator('#dataset-name')).toHaveText('corrected-data.csv');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download example CSV' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('sample-sales.csv');
  const downloadedPath = resolve('test-results/downloaded-example.csv');
  await download.saveAs(downloadedPath);
  const exampleChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose another file' }).click();
  await (await exampleChooser).setFiles(downloadedPath);
  await expect(page.locator('#dataset-name')).toHaveText('downloaded-example.csv');
  await expect(page.locator('#dataset-meta')).toHaveText('36 rows · 5 columns · Ready to analyze');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('uploaded cells render as text and malformed files show actionable errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from('name,amount\n<script>alert(1)</script>,7\n') });
  await expect(page.locator('#dataset-name')).toHaveText('test.csv');
  await page.locator('.data-preview summary').click();
  await expect(page.getByRole('cell', { name: '<script>alert(1)</script>' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove dataset' }).click();
  await page.locator('#file-input').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1\n') });
  await expect(page.locator('#toast')).toContainText('same number of columns');
  await expect(page.locator('#dataset-panel')).toBeHidden();
});

test('safety tests are disabled without a sandbox; mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('#service-status')).toContainText('Preview mode');
  await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Safety lab' }).click();
  await expect(page.locator('#safety-view')).toBeVisible();
  await expect(page.locator('#test-timeout')).toBeDisabled();
  await expect(page.locator('#test-boundary')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the live result interface renders a repaired execution from an explicit test fixture', async ({ page }) => {
  const id = '11111111-1111-1111-1111-111111111111';
  const evidence = { container: 'test-fixture-container', seconds: 20, memoryMB: 256, network: 'none', hostMounts: 0, secretsProvided: false, destroyed: true, codeSha256: 'test-fixture-hash' };
  const result = { id, kind: 'analysis', created: Date.now(), status: 'completed', filename: 'sample-sales.csv', title: 'Fixture total', question: 'Find total', code: 'print(7)', report: { title: 'Fixture total', summary: 'The fixture total is 7.', metrics: [{ label: 'Total', value: '7', detail: 'Test fixture' }], findings: ['Computed from fixture rows.'], series: [] }, explanation: 'The fixture total is 7.', plan: ['Compute'], events: [{ type: 'repairing', message: 'Reading the actual error.', time: new Date().toISOString() }], attempts: [{ number: 1, stdout: '', stderr: 'KeyError: amount', exitCode: 1, evidence }, { number: 2, stdout: 'Total 7', stderr: '', exitCode: 0, evidence }], files: [] };
  await page.route('**/api/status', route => route.fulfill({ json: { ready: true, sandboxReady: true, inferenceReady: true, limits: { retentionMinutes: 60 } } }));
  await page.route('**/api/jobs', route => route.request().method() === 'POST' ? route.fulfill({ status: 202, json: { ...result, status: 'queued' } }) : route.fulfill({ json: { jobs: [] } }));
  await page.route(`**/api/jobs/${id}`, route => route.fulfill({ json: result }));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(resolve('data/sample-sales.csv'));
  await expect(page.locator('#dataset-name')).toHaveText('sample-sales.csv');
  await page.locator('#question').fill('Find the total revenue');
  await page.locator('#run-button').click();
  await expect(page.locator('#result-badge')).toHaveText('Executed · 2 attempts');
  await page.locator('.evidence-details summary').first().click();
  await expect(page.locator('#evidence-content')).toContainText('Container destroyed: true');
  await expect(page.locator('#evidence-content')).toContainText('Attempt 1 error log');
  await expect(page.locator('#run-button')).toBeEnabled();
});

test('submission visuals export as a PNG cover and a printable PDF slide deck', async ({ page }) => {
  await mkdir('docs', { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/cover.svg'); await page.screenshot({ path: 'public/cover.png' });
  await page.goto('/slides');
  await expect(page.locator('.slide')).toHaveCount(6);
  await page.pdf({ path: 'docs/presentation.pdf', format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
});
