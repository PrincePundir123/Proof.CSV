"""Package only the prepared project, never credentials or runtime/user data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = ['package.json', 'package-lock.json', 'playwright.config.js', 'README.md', 'LICENSE', '.gitignore', '.env.example', 'START-PREVIEW.bat', 'START-LOCAL.bat', 'STOP-LOCAL.bat']
FOLDERS = ['server', 'public', 'sandbox', 'data', 'deploy', 'docs', 'test', 'scripts']
archive_path = ROOT / 'proofcsv-project.zip'
with ZipFile(archive_path, 'w', ZIP_DEFLATED) as archive:
    for name in FILES:
        archive.write(ROOT / name, arcname=f'proofcsv/{name}')
    for folder in FOLDERS:
        for path in sorted((ROOT / folder).rglob('*')):
            if path.is_symlink() or not path.is_file() or '__pycache__' in path.parts:
                continue
            relative = path.resolve().relative_to(ROOT)
            archive.write(path, arcname=f'proofcsv/{relative.as_posix()}')
print(f'Packaged project: {archive_path.name} ({archive_path.stat().st_size:,} bytes)')
