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
  // RFC 4180-compatible parser: preserves commas/newlines inside quoted cells
  // and unescapes doubled quotes. Also strips a UTF-8 BOM from Excel exports.
  const source = content.replace(/^\uFEFF/, '');
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (char === '"') {
      if (inQuotes && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) matrix.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    throw new Error('ملف CSV يحتوي على علامة اقتباس غير مغلقة');
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== '')) matrix.push(row);
  if (matrix.length < 2) return [];

  const headers = matrix[0].map((header) => header.trim());
  return matrix.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (values[index] ?? '').trim();
    });
    return record;
  });
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
