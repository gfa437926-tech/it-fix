import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { SparePart, MaintenancePartUsage } from '../types';

export function watchSpareParts(
  onData: (parts: SparePart[]) => void,
  onError?: (err: Error) => void
) {
  const partsRef = collection(db, 'spare_parts');
  const q = query(partsRef, orderBy('name', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const parts = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as SparePart[];
      onData(parts);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'spare_parts');
      onError?.(error as Error);
    }
  );
}

export function watchMaintenanceUsages(
  maintenanceId: string,
  onData: (usages: MaintenancePartUsage[]) => void
) {
  const ref = collection(db, 'maintenance_parts');
  const q = query(ref, where('maintenanceId', '==', maintenanceId));

  return onSnapshot(
    q,
    (snapshot) => {
      const usages = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as MaintenancePartUsage[];
      onData(usages);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'maintenance_parts');
    }
  );
}

export async function addSparePart(part: Omit<SparePart, 'id'> & { id?: string }) {
  const partId = part.id || doc(collection(db, 'spare_parts')).id;
  const ref = doc(db, 'spare_parts', partId);

  try {
    const now = new Date().toISOString();
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error('معرف قطعة الغيار مستخدم مسبقاً');

      tx.set(ref, {
        ...part,
        id: partId,
        sku: part.sku.trim().toUpperCase(),
        name: part.name.trim(),
        quantity: Number(part.quantity) || 0,
        minimumQuantity: Number(part.minimumQuantity) || 0,
        unitCost: Number(part.unitCost) || 0,
        supplier: part.supplier.trim(),
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `spare_parts/${partId}`);
  }
}

export async function consumeSparePart(
  partId: string,
  maintenanceId: string,
  quantity: number,
  notes: string = '',
  actorName: string = ''
) {
  if (quantity <= 0) throw new Error('الكمية المصروفة يجب أن تكون أكبر من صفر');

  const partRef = doc(db, 'spare_parts', partId);
  const ticketRef = doc(db, 'maintenance_records', maintenanceId);
  const usageRef = doc(collection(db, 'maintenance_parts'));

  try {
    await runTransaction(db, async (tx) => {
      const partSnap = await tx.get(partRef);
      const ticketSnap = await tx.get(ticketRef);

      if (!partSnap.exists()) throw new Error('قطعة الغيار غير موجودة');
      if (!ticketSnap.exists()) throw new Error('طلب الصيانة غير موجود');

      const part = partSnap.data();
      const ticket = ticketSnap.data();

      if (ticket.status === 'completed' || ticket.status === 'cancelled') {
        throw new Error('لا يمكن صرف قطع غيار لطلب صيانة مغلق');
      }

      const available = Number(part.quantity) || 0;
      if (available < quantity) {
        throw new Error(`الكمية المتاحة (${available}) غير كافية لصرف (${quantity})`);
      }

      const unitCost = Number(part.unitCost) || 0;
      const totalCost = unitCost * quantity;
      const now = new Date().toISOString();

      tx.update(partRef, {
        quantity: available - quantity,
        updatedAt: now,
      });

      const currentPartsCost = Number(ticket.partsCost) || 0;
      tx.update(ticketRef, {
        partsCost: currentPartsCost + totalCost,
      });

      tx.set(usageRef, {
        id: usageRef.id,
        partId,
        partName: part.name || '',
        maintenanceId,
        assetId: ticket.assetId || '',
        quantity,
        unitCost,
        totalCost,
        notes: notes.trim() || `صرف بواسطة ${actorName || 'المسؤول'}`,
        usedAt: now,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `maintenance_parts/${usageRef.id}`);
  }
}
