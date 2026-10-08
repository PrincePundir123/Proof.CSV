"""Trusted container entrypoint. Never execute this runner on the application host."""
import base64
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import stat
import subprocess
import sys

WORK = Path('/workspace')
OUTPUT = WORK / 'output'
MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 4 * 1024 * 1024
ALLOWED = {'.png', '.jpg', '.jpeg', '.csv', '.json', '.txt'}


def restrict_child():
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE, MAX_FILE))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main():
    payload = json.loads(sys.stdin.buffer.read(3 * 1024 * 1024))
    code, csv = payload['code'], payload['csv']
    if not isinstance(code, str) or len(code) > 50000 or not isinstance(csv, str) or len(csv.encode()) > MAX_FILE:
        raise ValueError('Input exceeds sandbox limits.')
    timeout = max(1, min(60, int(os.environ.get('RUN_TIMEOUT', '20'))))
    OUTPUT.mkdir(mode=0o700)
    (WORK / 'input.csv').write_text(csv, encoding='utf-8')
    (WORK / 'agent.py').write_text(code, encoding='utf-8')
    timed_out = False
    # Explicit environment: no application or inference credentials are inherited.
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp', 'MPLBACKEND': 'Agg', 'MPLCONFIGDIR': '/tmp/matplotlib', 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    with (WORK / 'stdout.log').open('wb') as out, (WORK / 'stderr.log').open('wb') as err:
        process = subprocess.Popen([sys.executable, '-I', '/workspace/agent.py'], cwd=WORK, env=env, stdout=out, stderr=err, start_new_session=True, preexec_fn=restrict_child)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
        finally:
            # Kill descendants even when their parent exits successfully.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
    def tail(path):
        # Generated code can alter its own files, so never follow symlinks here.
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        try:
            descriptor = os.open(path, flags)
            with os.fdopen(descriptor, 'rb') as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode):
                    return 'Log unavailable: nonregular file.'
                stream.seek(max(0, metadata.st_size - 12000))
                return stream.read(12000).decode('utf-8', errors='replace')
        except OSError:
            return 'Log unavailable.'
    files, total = [], 0
    if OUTPUT.is_dir() and not OUTPUT.is_symlink():
        for path in sorted(OUTPUT.iterdir()):
            if len(files) >= 8 or path.suffix.lower() not in ALLOWED:
                continue
            try:
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, 'rb') as stream:
                    metadata = os.fstat(stream.fileno())
                    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_FILE or total + metadata.st_size > MAX_TOTAL:
                        continue
                    data = stream.read(MAX_FILE + 1)
                    if len(data) > MAX_FILE or total + len(data) > MAX_TOTAL:
                        continue
            except OSError:
                continue
            total += len(data)
            files.append({'name': path.name, 'data': base64.b64encode(data).decode(), 'sha256': hashlib.sha256(data).hexdigest()})
    result = {'exitCode': process.returncode, 'timedOut': timed_out, 'stdout': tail(WORK / 'stdout.log'), 'stderr': tail(WORK / 'stderr.log'), 'files': files}
    if timed_out:
        result['stderr'] += '\nExecution stopped at the time limit.'
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Internal failures do not produce a success-shaped protocol response.
        print('Sandbox runner failed.', file=sys.stderr)
        sys.exit(1)
