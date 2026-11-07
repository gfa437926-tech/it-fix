#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scopedCollections = [
  'assets',
  'custody_cards',
  'maintenance_records',
  'asset_movements',
  'asset_documents',
  'maintenance_parts',
  'inventory_checks',
];

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function auditRows(collectionName, rows) {
  if (!Array.isArray(rows)) throw new Error(`Collection "${collectionName}" must be an array in the export JSON`);
  const result = {
    collection: collectionName,
    total: rows.length,
    missingOfficeId: 0,
    missingWarehouseId: 0,
    missingBoth: 0,
    examples: [],
  };

  rows.forEach((row, index) => {
    const missingOffice = isBlank(row?.officeId);
    const missingWarehouse = isBlank(row?.warehouseId);
    if (missingOffice) result.missingOfficeId += 1;
    if (missingWarehouse) result.missingWarehouseId += 1;
    if (missingOffice && missingWarehouse) {
      result.missingBoth += 1;
      if (result.examples.length < 20) {
        result.examples.push({
          id: row?.id ?? row?.docId ?? `row-${index + 1}`,
          reason: 'missing_office_and_warehouse',
        });
      }
    }
  });

  return result;
}

function main() {
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('Usage: npm run audit:scope -- --input <firestore-export.json>');
  }

  const parsed = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  const collections = parsed.collections && typeof parsed.collections === 'object'
    ? parsed.collections
    : parsed;
  const report = {
    mode: 'DRY_RUN_ONLY',
    source: resolve(inputPath),
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    collections: scopedCollections
      .filter((name) => Object.prototype.hasOwnProperty.call(collections, name))
      .map((name) => auditRows(name, collections[name])),
    spare_parts: Object.prototype.hasOwnProperty.call(collections, 'spare_parts')
      ? (() => {
          const rows = collections.spare_parts;
          if (!Array.isArray(rows)) throw new Error('Collection "spare_parts" must be an array in the export JSON');
          const examples = [];
          let missingWarehouseId = 0;
          rows.forEach((row, index) => {
            if (isBlank(row?.warehouseId)) {
              missingWarehouseId += 1;
              if (examples.length < 20) examples.push({ id: row?.id ?? row?.docId ?? `row-${index + 1}` });
            }
          });
          return { total: rows.length, missingWarehouseId, examples };
        })()
      : null,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
