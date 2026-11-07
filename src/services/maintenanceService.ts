import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { buildAssignedScopeConstraintGroups } from './scopedQueries';
import { MaintenanceRecord, MaintenancePriority, UserProfile } from '../types';

export function watchMaintenanceRecords(
  onData: (records: MaintenanceRecord[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'maintenance_records');
  if (scope?.accessControlEnabled === true) {
    const groups = buildAssignedScopeConstraintGroups(scope.officeIds || [], scope.warehouseIds || []);
    if (!groups.length) { onData([]); return () => undefined; }
    const snapshots = new Map<string, Map<string, MaintenanceRecord>>();
    const unsubs = groups.map(({ key, constraints }) => onSnapshot(
      query(ref, ...constraints, orderBy('reportedAt', 'desc')),
      (snapshot) => {
        snapshots.set(key, new Map(snapshot.docs.map((item) => [
          item.id, { id: item.id, ...item.data() } as MaintenanceRecord,
        ])));
        const merged = new Map<string, MaintenanceRecord>();
        snapshots.forEach((items) => items.forEach((record, id) => merged.set(id, record)));
        onData([...merged.values()].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)));
      },
      (error) => { handleFirestoreError(error, OperationType.GET, 'maintenance_records'); onError?.(error as Error); }
    ));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }
  return onSnapshot(query(ref, orderBy('reportedAt', 'desc')), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as MaintenanceRecord[]);
  }, (error) => { handleFirestoreError(error, OperationType.GET, 'maintenance_records'); onError?.(error as Error); });
}

export async function createMaintenanceRecord(
  ticket: {
    assetId: string;
    assetLabel: string;
    title: string;
    description: string;
    priority: MaintenancePriority;
    technician?: string;
  },
  actorName: string = ''
) {
  const title = ticket.title.trim();
  const description = ticket.description.trim();
  if (!ticket.assetId.trim()) throw new Error('يجب تحديد الأصل قبل فتح طلب الصيانة');
  if (!title) throw new Error('عنوان طلب الصيانة مطلوب');
  if (!description) throw new Error('وصف العطل مطلوب');

  const recordId = doc(collection(db, 'maintenance_records')).id;
  const assetRef = doc(db, 'assets', ticket.assetId);
  const recordRef = doc(db, 'maintenance_records', recordId);

  try {
    await runTransaction(db, async (tx) => {
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الأصل المحدد غير موجود');

      const assetData = assetSnap.data();
      const previousStatus = assetData.status || 'available';

      if (previousStatus === 'retired') {
        throw new Error('لا يمكن فتح صيانة لجهاز مستبعد أو تالف كلياً');
      }
      if (previousStatus === 'maintenance') {
        throw new Error('الجهاز مسجل قيد الصيانة بالفعل في طلب آخر');
      }

      const now = new Date().toISOString();
      const newRecord: MaintenanceRecord = {
        id: recordId,
        assetId: ticket.assetId,
        assetLabel: ticket.assetLabel || `${assetData.brand || ''} ${assetData.model || ''}`.trim(),
        title,
        description,
        priority: ticket.priority,
        officeId: assetData.officeId || '',
        warehouseId: assetData.warehouseId || '',
        status: 'open',
        reportedAt: now,
        technician: ticket.technician?.trim() || '',
        cost: 0,
        partsCost: 0,
        previousAssetStatus: previousStatus,
      };

      tx.set(recordRef, newRecord);
      tx.update(assetRef, { status: 'maintenance' });

      const movement = doc(collection(db, 'asset_movements'));
      tx.set(movement, {
        assetId: ticket.assetId,
        officeId: newRecord.officeId || '',
        warehouseId: newRecord.warehouseId || '',
        assetLabel: newRecord.assetLabel,
        movementType: 'maintenance_opened',
        occurredAt: now,
        maintenanceId: recordId,
        notes: `فتح طلب صيانة: ${title} (بواسطة ${actorName || 'المسؤول'})`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `maintenance_records/${recordId}`);
  }
}

export async function completeMaintenanceRecord(
  record: MaintenanceRecord,
  resolution: string,
  cost: number,
  actorName: string = ''
) {
  const normalizedResolution = resolution.trim();
  const normalizedCost = Number(cost);
  if (!normalizedResolution) throw new Error('يجب إدخال وصف الحل قبل إغلاق الصيانة');
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
    throw new Error('تكلفة الصيانة يجب أن تكون رقماً صحيحاً غير سالب');
  }

  const recordRef = doc(db, 'maintenance_records', record.id);
  const assetRef = doc(db, 'assets', record.assetId);

  try {
    await runTransaction(db, async (tx) => {
      const recordSnap = await tx.get(recordRef);
      if (!recordSnap.exists()) throw new Error('طلب الصيانة غير موجود');

      const data = recordSnap.data() as MaintenanceRecord;
      if (data.status === 'completed' || data.status === 'cancelled') {
        throw new Error('الطلب مغلق مسبقاً');
      }
      if (!data.assetId || data.assetId !== record.assetId) {
        throw new Error('بيانات الأصل في طلب الصيانة غير متطابقة؛ راجع الطلب قبل إغلاقه');
      }

      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الجهاز المرتبط غير موجود');
      if (assetSnap.data().status !== 'maintenance') {
        throw new Error('حالة الأصل لم تعد قيد الصيانة؛ لا يمكن إغلاق الطلب قبل مراجعة حالة الأصل');
      }

      const previousStatus = data.previousAssetStatus || 'available';
      const now = new Date().toISOString();

      tx.update(recordRef, {
        status: 'completed',
        resolution: normalizedResolution,
        cost: normalizedCost,
        completedAt: now,
      });

      // Restore asset status to previous status (e.g. assigned or available)
      tx.update(assetRef, { status: previousStatus });

      const movement = doc(collection(db, 'asset_movements'));
      tx.set(movement, {
        assetId: data.assetId,
        officeId: data.officeId || '',
        warehouseId: data.warehouseId || '',
        assetLabel: data.assetLabel,
        movementType: 'maintenance_completed',
        occurredAt: now,
        maintenanceId: record.id,
        notes: `إكمال الصيانة: ${normalizedResolution} (بواسطة ${actorName || 'المسؤول'})`,
        cost: normalizedCost,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `maintenance_records/${record.id}`);
  }
}
