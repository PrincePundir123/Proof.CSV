import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.js';
import { createSandbox } from '../server/sandbox.js';
import { SAFETY_CODE } from '../server/jobs.js';
import { sampleData } from '../server/sample.js';

const sandbox = createSandbox(readConfig());
test('real Docker: chart execution, artifact validation, offline boundaries, time limits and verified destruction', async () => {
  const status = await sandbox.ready();
  assert.equal(status.ready, true, `Runtime verification requires Docker and the built image: ${status.reason || ''}`);
  const sample = await sampleData();
  const analysis = await sandbox.execute(sample.code, sample.csv);
  assert.equal(analysis.exitCode, 0); assert.equal(analysis.evidence.destroyed, true);
  assert.ok(analysis.files.some(file => file.name === 'revenue.png'));
  assert.equal(JSON.parse(analysis.files.find(file => file.name === 'report.json').buffer.toString()).metrics[0].value, 'INR 110,940');
  const isolation = await sandbox.execute(SAFETY_CODE.boundary, 'a\n1');
  assert.equal(isolation.exitCode, 0); assert.equal(isolation.evidence.destroyed, true);
  assert.equal(Object.values(JSON.parse(isolation.stdout.trim())).every(Boolean), true);
  const limits = await sandbox.execute(`from pathlib import Path
assert Path('/sys/fs/cgroup/memory.max').read_text().strip() == '268435456'
assert Path('/sys/fs/cgroup/pids.max').read_text().strip() == '64'
quota, period = map(int, Path('/sys/fs/cgroup/cpu.max').read_text().split())
assert quota / period == 0.5
print('Memory, CPU and process limits verified in cgroup v2')`, 'a\n1');
  assert.equal(limits.exitCode, 0, limits.stderr); assert.equal(limits.evidence.destroyed, true);
  const bounded = await sandbox.execute(SAFETY_CODE.timeout, 'a\n1', 3);
  assert.equal(bounded.timedOut, true); assert.equal(bounded.evidence.destroyed, true);
  // No leftover workspace is reused by the next task.
  const next = await sandbox.execute('from pathlib import Path\nassert not Path("/workspace/output/revenue.png").exists()\nprint("Fresh workspace confirmed")', 'a\n1');
  assert.equal(next.exitCode, 0); assert.equal(next.evidence.destroyed, true);
});
