import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('scope audit is dry-run only and reports missing scope without changing input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'itfix-scope-audit-'));
  const input = join(directory, 'export.json');
  const original = JSON.stringify({
    collections: {
      assets: [
        { id: 'asset-1', officeId: 'office-a', warehouseId: 'warehouse-a' },
        { id: 'asset-2', officeId: '', warehouseId: null },
      ],
      spare_parts: [
        { id: 'part-1', warehouseId: 'warehouse-a' },
        { id: 'part-2', warehouseId: '' },
      ],
    },
  });
  writeFileSync(input, original);
  try {
    const result = spawnSync(process.execPath, ['scripts/audit-scope-export.mjs', '--input', input], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, 'DRY_RUN_ONLY');
    assert.equal(report.writesPerformed, false);
    assert.equal(report.collections[0].total, 2);
    assert.equal(report.collections[0].missingBoth, 1);
    assert.equal(report.spare_parts.missingWarehouseId, 1);
    assert.equal(readFileSync(input, 'utf8'), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scope audit rejects missing input and malformed collection without mutating source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'itfix-scope-audit-invalid-'));
  const input = join(directory, 'export.json');
  try {
    const missing = spawnSync(process.execPath, ['scripts/audit-scope-export.mjs'], { encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Usage:/);

    const original = JSON.stringify({ collections: { assets: { id: 'not-an-array' } } });
    writeFileSync(input, original);
    const malformed = spawnSync(process.execPath, ['scripts/audit-scope-export.mjs', '--input', input], {
      encoding: 'utf8',
    });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /must be an array/);
    assert.equal(readFileSync(input, 'utf8'), original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
