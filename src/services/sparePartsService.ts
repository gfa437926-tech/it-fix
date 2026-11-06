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
import { SparePart, MaintenancePartUsage, UserProfile } from '../types';

export function watchSpareParts(
  onData: (parts: SparePart[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'spare_parts');
  if (scope?.accessControlEnabled === true) {
    const ids = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    if (!ids.length) { onData([]); return () => undefined; }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const snapshots = new Map<string, Map<string, SparePart>>();
    const unsubs = chunks.map((chunk, index) => onSnapshot(
      query(ref, where('warehouseId', 'in', chunk), orderBy('name', 'asc')),
      (snapshot) => {
        snapshots.set(String(index), new Map(snapshot.docs.map((item) => [
          item.id, { id: item.id, ...item.data() } as SparePart,
        ])));
        const merged = new Map<string, SparePart>();
        snapshots.forEach((items) => items.forEach((part, id) => merged.set(id, part)));
        onData([...merged.values()].sort((a, b) => a.name.localeCompare(b.name)));
      },
      (error) => { handleFirestoreError(error, OperationType.GET, 'spare_parts'); onError?.(error as Error); }
    ));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }
  return onSnapshot(query(ref, orderBy('name', 'asc')), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as SparePart[]);
  }, (error) => { handleFirestoreError(error, OperationType.GET, 'spare_parts'); onError?.(error as Error); });
}

export function watchMaintenanceUsages(
  maintenanceId: string,
  onData: (usages: MaintenancePartUsage[]) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'maintenance_parts');
  if (scope?.accessControlEnabled === true) {
    const groups: { field: 'officeId' | 'warehouseId'; ids: string[] }[] = [];
    const offices = [...new Set(scope.officeIds || [])].filter(Boolean);
    const warehouses = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    for (let i = 0; i < offices.length; i += 30) groups.push({ field: 'officeId', ids: offices.slice(i, i + 30) });
    for (let i = 0; i < warehouses.length; i += 30) groups.push({ field: 'warehouseId', ids: warehouses.slice(i, i + 30) });
    if (!groups.length) { onData([]); return () => undefined; }
    const snapshots = new Map<string, Map<string, MaintenancePartUsage>>();
    const unsubs = groups.map(({ field, ids }) => onSnapshot(
      query(ref, where('maintenanceId', '==', maintenanceId), where(field, 'in', ids)),
      (snapshot) => {
        snapshots.set(field + ':' + ids.join(','), new Map(snapshot.docs.map((item) => [
          item.id, { id: item.id, ...item.data() } as MaintenancePartUsage,
        ])));
        const merged = new Map<string, MaintenancePartUsage>();
        snapshots.forEach((items) => items.forEach((usage, id) => merged.set(id, usage)));
        onData([...merged.values()]);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'maintenance_parts')
    ));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }
  return onSnapshot(query(ref, where('maintenanceId', '==', maintenanceId)), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as MaintenancePartUsage[]);
  }, (error) => handleFirestoreError(error, OperationType.GET, 'maintenance_parts'));
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
        warehouseId: part.warehouseId || '',
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
        officeId: ticket.officeId || '',
        warehouseId: ticket.warehouseId || part.warehouseId || '',
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
