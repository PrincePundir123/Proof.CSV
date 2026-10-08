import { resolve } from 'node:path';

function integer(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Configuration value must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export function readConfig(env = process.env) {
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('PUBLIC_ORIGIN must be HTTP or HTTPS.');
  const image = env.SANDBOX_IMAGE || 'proofcsv-sandbox:1';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]{0,200}$/.test(image)) throw new Error('Invalid sandbox image.');
  const runtime = env.SANDBOX_RUNTIME || '';
  if (runtime && !/^[a-zA-Z0-9_-]{1,40}$/.test(runtime)) throw new Error('Invalid sandbox runtime.');
  const dockerTransport = env.DOCKER_TRANSPORT || 'native';
  if (!['native', 'wsl'].includes(dockerTransport)) throw new Error('DOCKER_TRANSPORT must be native or wsl.');
  const wslDistro = env.WSL_DISTRO || 'Ubuntu';
  const wslUser = env.WSL_USER || 'root';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(wslDistro) || !/^[a-z_][a-z0-9_-]{0,31}$/.test(wslUser)) throw new Error('Invalid WSL distribution or user.');
  const provider = env.MODEL_PROVIDER || 'vultr';
  if (!['vultr', 'local'].includes(provider)) throw new Error('MODEL_PROVIDER must be vultr or local.');
  const localBase = new URL(env.LOCAL_MODEL_URL || 'http://127.0.0.1:11434/v1');
  const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (provider === 'local' && (!loopback(localBase.hostname) || localBase.protocol !== 'http:' || !loopback(origin.hostname) || !loopback(env.HOST || '127.0.0.1'))) throw new Error('Local AI mode must use loopback addresses for the app and model. Use Vultr mode for public deployment.');
  const inferenceBase = provider === 'local' ? localBase.href.replace(/\/$/, '') : 'https://api.vultrinference.com/v1';
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env.PORT, 3000, 0, 65535),
    origin: origin.origin,
    apiKey: env.VULTR_SERVERLESS_INFERENCE_API_KEY || '',
    provider,
    model: provider === 'local' ? env.LOCAL_MODEL || 'proofcsv-local' : env.VULTR_MODEL || '',
    inferenceUrl: `${inferenceBase}/chat/completions`,
    modelsUrl: `${inferenceBase}/models`,
    modelTimeoutMs: integer(env.MODEL_TIMEOUT_SECONDS, provider === 'local' ? 600 : 60, 15, 600) * 1000,
    image, runtime, dockerTransport, wslDistro, wslUser,
    timeout: integer(env.SANDBOX_TIMEOUT_SECONDS, 20, 3, 60),
    maxConcurrent: integer(env.MAX_CONCURRENT_JOBS, 2, 1, 4),
    dailyCalls: integer(env.MAX_DAILY_MODEL_CALLS, 100, 1, 1000),
    ttlMs: integer(env.DATA_TTL_MINUTES, 60, 5, 1440) * 60_000,
    secureCookie: env.COOKIE_SECURE === 'true',
    dataDir: resolve('runtime'),
    maxBodyBytes: 3 * 1024 * 1024,
    maxCsvBytes: 2 * 1024 * 1024,
  };
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
