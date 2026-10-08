import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const directories = ['server', 'public', 'scripts', 'test'];
let failed = false, checked = 0;
for (const directory of directories) {
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) { process.stderr.write(result.stderr || result.error?.message || 'Syntax checker could not start.'); failed = true; }
    checked++;
  }
}
console.log(`Checked syntax in ${checked} JavaScript files.`);
if (failed) process.exitCode = 1;
