"""Download official CPU runtime and publisher-verified Qwen quantization."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import time
import threading
import urllib.request
from urllib.error import URLError
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'runtime' / 'local-ai'
DEST.mkdir(parents=True, exist_ok=True)


def request(url, headers=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ProofCSV-local-setup', **(headers or {})}), timeout=60)


def metadata(url):
    with request(url) as response:
        return json.load(response)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def download(url, path, expected_size, expected_hash=None):
    if path.exists() and path.stat().st_size == expected_size and (not expected_hash or digest(path) == expected_hash):
        print(f'Already verified: {path.name}', flush=True)
        return
    part = path.with_suffix(path.suffix + '.part')
    offset = part.stat().st_size if part.exists() else 0
    if offset > expected_size:
        raise RuntimeError('Existing partial download is larger than the official file.')
    with request(url, {'Range': f'bytes={offset}-'} if offset else {}) as response:
        if offset and response.status != 206:
            offset = 0
        with part.open('ab' if offset else 'wb') as stream:
            last = 0
            while chunk := response.read(4 * 1024 * 1024):
                stream.write(chunk)
                offset += len(chunk)
                if time.monotonic() - last > 15:
                    print(f'{path.name}: {offset // 1024**2:,} / {expected_size // 1024**2:,} MB', flush=True)
                    last = time.monotonic()
    if offset != expected_size:
        raise RuntimeError('Download size does not match the official metadata. Run setup again to resume.')
    if expected_hash and digest(part) != expected_hash:
        raise RuntimeError('Downloaded file failed its publisher SHA-256 check.')
    part.replace(path)
    print(f'Verified download: {path.name}', flush=True)


def download_model(url, path, expected_size, expected_hash):
    if path.exists() and path.stat().st_size == expected_size and digest(path) == expected_hash:
        print(f'Already verified: {path.name}', flush=True)
        return
    # Independent ranges avoid slow single-connection downloads. Every range and
    # the complete publisher hash are checked; incomplete chunks can be resumed.
    chunk_dir = path.parent / (path.name + '.chunks')
    chunk_dir.mkdir(exist_ok=True)
    if not chunk_dir.resolve().is_relative_to(DEST.resolve()):
        raise RuntimeError('Download chunks must stay in the project runtime.')
    count = 8
    sizes = [0] * count
    lock = threading.Lock()
    last_print = [0]
    def fetch_once(index):
        start, end = expected_size * index // count, expected_size * (index + 1) // count - 1
        target = chunk_dir / f'{index}.part'
        present = target.stat().st_size if target.exists() else 0
        if present > end - start + 1:
            raise RuntimeError('A download chunk is too large.')
        sizes[index] = present
        if present == end - start + 1:
            return target
        ranged_url = f'{url}?download=true&proofcsv_part={index}&offset={present}'
        with request(ranged_url, {'Range': f'bytes={start + present}-{end}'}) as response:
            if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start + present}-{end}/{expected_size}':
                raise RuntimeError('The model publisher did not honor the requested byte range.')
            with target.open('ab') as stream:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
                    with lock:
                        sizes[index] += len(chunk)
                        if time.monotonic() - last_print[0] > 15:
                            print(f'{path.name}: {sum(sizes) // 1024**2:,} / {expected_size // 1024**2:,} MB', flush=True)
                            last_print[0] = time.monotonic()
        if target.stat().st_size != end - start + 1:
            raise RuntimeError('Incomplete model chunk. Rerun setup to resume.')
        return target
    def fetch_chunk(index):
        for attempt in range(4):
            try:
                return fetch_once(index)
            except (TimeoutError, ConnectionError, URLError):
                if attempt == 3:
                    raise
                print(f'Resuming model chunk {index + 1}/8 after a connection interruption.', flush=True)
    with ThreadPoolExecutor(max_workers=count) as pool:
        chunks = list(pool.map(fetch_chunk, range(count)))
    part = path.with_suffix(path.suffix + '.part')
    with part.open('wb') as output:
        for target in chunks:
            with target.open('rb') as stream:
                while chunk := stream.read(8 * 1024 * 1024):
                    output.write(chunk)
    if part.stat().st_size != expected_size or digest(part) != expected_hash:
        raise RuntimeError('The model failed its publisher size or SHA-256 check.')
    part.replace(path)
    for target in chunks:
        target.unlink()
    chunk_dir.rmdir()
    print(f'Verified download: {path.name}', flush=True)


release = metadata('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest')
assets = [asset for asset in release['assets'] if asset['name'].endswith('bin-win-cpu-x64.zip')]
if not assets:
    # Stable releases link the official nightly binaries rather than attaching them.
    nightly = re.search(r'https://github\.com/ggml-org/llama\.cpp/releases/tag/(b\d+)', release.get('body', ''))
    if not nightly:
        raise RuntimeError('The official release did not link a binary build.')
    release = metadata(f'https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/{nightly[1]}')
    assets = [asset for asset in release['assets'] if asset['name'].endswith('bin-win-cpu-x64.zip')]
if len(assets) != 1:
    raise RuntimeError('Could not identify the official Windows CPU runtime asset.')
asset = assets[0]
runtime_zip = DEST / asset['name']
published_digest = asset.get('digest') or ''
runtime_hash = published_digest.removeprefix('sha256:') if published_digest.startswith('sha256:') else None
download(asset['browser_download_url'], runtime_zip, asset['size'], runtime_hash)
binary_dir = DEST / 'bin'
binary_dir.mkdir(exist_ok=True)
with zipfile.ZipFile(runtime_zip) as archive:
    for info in archive.infolist():
        target = (binary_dir / info.filename).resolve()
        if not target.is_relative_to(binary_dir.resolve()) or (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise RuntimeError('Unsafe path in runtime archive.')
    for info in archive.infolist():
        target = (binary_dir / info.filename).resolve()
        if not info.is_dir() and target.is_file() and digest(target) == hashlib.sha256(archive.read(info)).hexdigest():
            continue  # Do not rewrite verified DLLs while the model server is running.
        archive.extract(info, binary_dir)
executables = list(binary_dir.rglob('llama-server.exe'))
if len(executables) != 1:
    raise RuntimeError('The official runtime did not contain one llama-server executable.')

model_repository = 'unsloth/Qwen3.5-4B-GGUF'
model_info = metadata(f'https://huggingface.co/api/models/{model_repository}?blobs=true')
filename = 'Qwen3.5-4B-Q4_K_M.gguf'
entry = next(item for item in model_info['siblings'] if item['rfilename'] == filename)
model_hash = entry['lfs']['sha256']
if not re.fullmatch('[a-f0-9]{64}', model_hash):
    raise RuntimeError('The model publisher supplied no usable SHA-256 metadata.')
model_path = DEST / filename
model_url = f"https://huggingface.co/{model_repository}/resolve/{model_info['sha']}/{filename}"
download_model(model_url, model_path, entry['lfs']['size'], model_hash)
config = {'executable': str(executables[0].relative_to(ROOT)), 'model': str(model_path.relative_to(ROOT)), 'release': release['tag_name'], 'runtimeSha256': digest(runtime_zip), 'modelSha256': model_hash, 'modelRevision': model_info['sha'], 'modelRepository': model_repository}
(DEST / 'installed.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
print('Local AI runtime and model are installed and verified.', flush=True)
