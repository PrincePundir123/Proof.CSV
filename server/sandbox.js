import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

export function command(binary, args, { input, timeoutMs = 10_000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    let size = 0, forced = '';
    const timer = setTimeout(() => { forced = 'The sandbox exceeded its wall-clock limit.'; child.kill('SIGKILL'); }, timeoutMs);
    const append = target => chunk => {
      size += chunk.length;
      if (size > maxBytes) { forced = 'The sandbox output exceeded its size limit.'; child.kill('SIGKILL'); }
      else target.push(chunk);
    };
    child.stdout.on('data', append(out)); child.stderr.on('data', append(err));
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), forced }); });
    child.stdin.end(input || '');
  });
}

export function sandboxArgs(config, name, seconds) {
  return [
    'create', '--name', name, '--label', 'proofcsv.managed=true', '--interactive',
    '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true', '--user', '10001:10001',
    '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--pids-limit', '64',
    '--ulimit', 'nofile=64:64', '--ulimit', 'fsize=2097152:2097152',
    '--tmpfs', '/workspace:rw,nosuid,nodev,noexec,size=32m,uid=10001,gid=10001,mode=0700',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m,uid=10001,gid=10001,mode=0700',
    '--env', `RUN_TIMEOUT=${seconds}`, '--env', 'PYTHONDONTWRITEBYTECODE=1',
    ...(config.runtime ? ['--runtime', config.runtime] : []), config.image,
  ];
}

export function validateArtifacts(files) {
  if (!Array.isArray(files) || files.length > 8) throw new Error('The sandbox returned an invalid artifact list.');
  let total = 0;
  const names = new Set();
  return files.map(file => {
    if (typeof file.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(file.name) || names.has(file.name)) throw new Error('The sandbox returned an unsafe filename.');
    names.add(file.name);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!TYPES[ext] || typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error('The sandbox returned an unsupported file.');
    const buffer = Buffer.from(file.data, 'base64');
    total += buffer.length;
    if (buffer.length > 2 * 1024 * 1024 || total > 4 * 1024 * 1024) throw new Error('The sandbox returned too much data.');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (file.sha256 !== sha256) throw new Error('An artifact failed its integrity check.');
    // A chart must really be an image, rather than executable text with an image extension.
    if (ext === '.png' && !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG artifact.');
    if (['.jpg', '.jpeg'].includes(ext) && (buffer[0] !== 255 || buffer[1] !== 216)) throw new Error('Invalid JPEG artifact.');
    return { name: file.name, type: TYPES[ext], bytes: buffer.length, sha256, buffer };
  });
}

export function createSandbox(config, run = command) {
  function docker(args, options) {
    if (config.dockerTransport === 'wsl') return run('wsl.exe', ['-d', config.wslDistro, '-u', config.wslUser, '--', 'docker', ...args], { timeoutMs: 30_000, ...options });
    return run('docker', args, options);
  }
  return {
    async keepAlive() {
      try { return (await docker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 30_000, maxBytes: 10_000 })).code === 0; }
      catch { return false; }
    },
    async ready() {
      try {
        const info = await docker(['info', '--format', '{{json .}}'], { timeoutMs: 10_000, maxBytes: 200_000 });
        if (info.code !== 0) return { ready: false, reason: 'Docker is not running.' };
        const details = JSON.parse(info.stdout);
        // Fail closed when Docker cannot enforce the challenge's required resource limits.
        if (details.MemoryLimit !== true || details.PidsLimit !== true || details.CpuCfsQuota !== true) return { ready: false, reason: 'Docker must support memory, process, and CPU limits.' };
        const image = await docker(['image', 'inspect', config.image], { timeoutMs: 10_000, maxBytes: 100_000 });
        return image.code === 0 ? { ready: true } : { ready: false, reason: 'Build the ProofCSV sandbox image first.' };
      } catch { return { ready: false, reason: 'Docker is not installed or is unavailable.' }; }
    },
    async execute(code, csv, seconds = config.timeout) {
      const name = `proofcsv-${randomUUID()}`;
      const evidence = { container: name, codeSha256: createHash('sha256').update(code).digest('hex'), network: 'none', memoryMB: 256, cpu: 0.5, seconds, hostMounts: 0, secretsProvided: false, destroyed: false };
      let result, failure;
      const start = Date.now();
      try {
        const created = await docker(sandboxArgs(config, name, seconds));
        if (created.code !== 0) {
          const detail = config.provider === 'local' ? (created.forced || created.stderr || '').trim().slice(0, 800) : '';
          throw new Error(`Docker could not create the isolated execution environment.${detail ? ' ' + detail : ''}`);
        }
        const execution = await docker(['start', '--attach', '--interactive', name], { input: JSON.stringify({ code, csv }), timeoutMs: (seconds + 10) * 1000 });
        if (execution.forced) throw new Error(execution.forced);
        if (execution.code !== 0) throw new Error('The sandbox stopped unexpectedly; it may have reached its resource limit.');
        let payload;
        try { payload = JSON.parse(execution.stdout); } catch { throw new Error('The sandbox returned an invalid execution record.'); }
        if (!Number.isInteger(payload.exitCode) || typeof payload.timedOut !== 'boolean' || typeof payload.stdout !== 'string' || typeof payload.stderr !== 'string') throw new Error('Invalid sandbox execution metadata.');
        result = { exitCode: payload.exitCode, timedOut: payload.timedOut, stdout: payload.stdout.slice(0, 12_000), stderr: payload.stderr.slice(0, 12_000), files: validateArtifacts(payload.files), evidence };
      } catch (error) { failure = error; }
      finally {
        try {
          const removed = await docker(['rm', '--force', '--volumes', name], { timeoutMs: 10_000 });
          if (removed.code === 0) {
            const inspected = await docker(['container', 'inspect', name], { timeoutMs: 10_000 });
            evidence.destroyed = inspected.code !== 0 && /no such (?:container|object)/i.test(inspected.stderr);
          }
        } catch { evidence.destroyed = false; }
        evidence.durationMs = Date.now() - start;
      }
      if (!evidence.destroyed) throw new Error('Sandbox cleanup could not be verified. Execution has been disabled until the owner checks Docker.');
      if (failure) throw failure;
      return result;
    },
  };
}
