import { collection, doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { createAsset } from './assetService';
import { Asset, AssetCategory, ImportBatch } from '../types';

export interface ParsedImportRow {
  rowIndex: number;
  category: AssetCategory;
  brand: string;
  model: string;
  serialNumber: string;
  officeName: string;
  cpu?: string;
  ram?: string;
  storage?: string;
  error?: string;
}

export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

export async function processAssetBatch(
  rows: ParsedImportRow[],
  sourceName: string,
  createdBy: string,
  actorName: string,
  existingAssets: Asset[]
): Promise<ImportBatch> {
  const batchId = doc(collection(db, 'import_batches')).id;
  const createdAt = new Date().toISOString();

  let attemptedRows = 0;
  let succeededRows = 0;
  let failedRows = 0;
  let skippedInvalidRows = 0;
  const rowErrors: string[] = [];

  const seenSerials = new Set<string>(
    existingAssets.map((a) => (a.serialNumber || '').trim().toUpperCase()).filter(Boolean)
  );

  for (const row of rows) {
    if (row.error) {
      skippedInvalidRows++;
      continue;
    }

    attemptedRows++;
    const serial = (row.serialNumber || '').trim().toUpperCase();

    if (serial && seenSerials.has(serial)) {
      failedRows++;
      rowErrors.push(`السطر ${row.rowIndex}: الرقم التسلسلي (${serial}) مسجل مسبقاً`);
      continue;
    }

    try {
      await createAsset(
        {
          category: row.category,
          brand: row.brand,
          model: row.model,
          serialNumber: serial,
          status: 'available',
          officeName: row.officeName || 'المستودع الرئيسي',
          cpu: row.cpu || '',
          ram: row.ram || '',
          storage: row.storage || '',
        },
        actorName
      );

      if (serial) seenSerials.add(serial);
      succeededRows++;
    } catch (err: unknown) {
      failedRows++;
      const msg = err instanceof Error ? err.message : String(err);
      rowErrors.push(`السطر ${row.rowIndex}: فشل الحفظ - ${msg}`);
    }
  }

  const completedAt = new Date().toISOString();
  let status: 'completed' | 'partial' | 'failed' = 'completed';
  if (failedRows > 0 && succeededRows > 0) {
    status = 'partial';
  } else if (failedRows > 0 && succeededRows === 0) {
    status = 'failed';
  }

  const batchRecord: ImportBatch = {
    id: batchId,
    sourceName,
    createdBy,
    createdAt,
    completedAt,
    totalRows: rows.length,
    attemptedRows,
    succeededRows,
    failedRows,
    skippedInvalidRows,
    status,
    rowErrors,
  };

  try {
    await setDoc(doc(db, 'import_batches', batchId), batchRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `import_batches/${batchId}`);
  }

  return batchRecord;
}
