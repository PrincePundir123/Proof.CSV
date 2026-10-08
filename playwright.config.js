import { defineConfig } from '@playwright/test';

const testPort = Number(process.env.PROOFCSV_TEST_PORT || 3035);
if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) throw new Error('Choose a valid PROOFCSV_TEST_PORT.');
const testOrigin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: testOrigin,
    viewport: { width: 1440, height: 1050 },
    launchOptions: process.platform === 'win32' ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'node server/index.js', url: `${testOrigin}/healthz`, reuseExistingServer: !process.env.CI, timeout: 15_000, env: { HOST: '127.0.0.1', PORT: String(testPort), PUBLIC_ORIGIN: testOrigin, MODEL_PROVIDER: 'vultr', DOCKER_TRANSPORT: 'native', VULTR_SERVERLESS_INFERENCE_API_KEY: '', VULTR_MODEL: '' } },
});
