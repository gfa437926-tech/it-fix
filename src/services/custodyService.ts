import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CustodyRecord, CustodyItem, UserProfile } from '../types';

export async function saveOfficialCustodyCard(
  card: Partial<CustodyRecord> & {
    responsibleName: string;
    officeName: string;
    items: CustodyItem[];
  },
  actorUid: string,
  actorName: string,
  actorEmail?: string
): Promise<string> {
  const responsibleName = card.responsibleName.trim();
  const officeName = card.officeName.trim();
  if (!responsibleName) throw new Error('اسم الموظف المسؤول مطلوب');
  if (!officeName) throw new Error('اسم المكتب مطلوب');
  if (!Array.isArray(card.items)) throw new Error('قائمة محتويات العهدة غير صالحة');

  const cardId = card.id || doc(collection(db, 'custody_cards')).id;
  const cardRef = doc(db, 'custody_cards', cardId);
  const now = new Date().toISOString();

  const assetLabel =
    card.items?.map((i) => i.itemName).filter(Boolean).join('، ') ||
    card.assetLabel ||
    'تجهيزات حاسوبية وملحقاتها';

  const recordToSave: Partial<CustodyRecord> = {
    ...card,
    id: cardId,
    cardNumber: card.cardNumber?.trim() || `CR-${Date.now().toString().slice(-6)}`,
    formNumber: card.formNumber?.trim() || 'نموذج مستودع رقم (23)',
    provinceRegion: card.provinceRegion?.trim() || 'المركز الرئيسي',
    responsibleName: card.responsibleName.trim(),
    employeeName: card.responsibleName.trim(),
    roleTitle: card.roleTitle?.trim() || '',
    directorate: card.directorate?.trim() || '',
    department: card.department?.trim() || '',
    officeName: card.officeName.trim(),
    officeId: card.officeId || '',
    warehouseId: card.warehouseId || '',
    officeRoom: card.officeRoom?.trim() || '',
    assetLabel,
    assignedAt: card.assignedAt || now,
    status: card.status || 'active',
    approvalStatus: card.approvalStatus || 'approved',
    items: card.items || [],
    itDepartmentHead: card.itDepartmentHead?.trim() || '',
    inventoryTechName: card.inventoryTechName?.trim() || '',
    responsibleSignatureName:
      card.responsibleSignatureName?.trim() || card.responsibleName.trim(),
    createdByUid: card.createdByUid || actorUid,
    createdByEmail: card.createdByEmail || actorEmail || '',
  };

  try {
    // Keep the official custody card and its movement in one atomic write.
    const movementRef = doc(collection(db, 'asset_movements'));
    await runTransaction(db, async (tx) => {
      tx.set(cardRef, recordToSave, { merge: true });
      tx.set(movementRef, {
        assetId: cardId,
        officeId: recordToSave.officeId || '',
        warehouseId: recordToSave.warehouseId || '',
        assetLabel: `بطاقة عهدة: ${recordToSave.cardNumber} (${recordToSave.responsibleName})`,
        movementType: card.id ? 'custody_transferred' : 'assigned',
        toEmployee: recordToSave.responsibleName,
        toOffice: `${recordToSave.directorate || ''} / ${recordToSave.department || ''} / ${recordToSave.officeName}`,
        occurredAt: now,
        custodyId: cardId,
        notes: `تم توثيق بطاقة العهدة الرسمية بواسطة ${actorName || actorEmail || 'المتحكم'}`,
      });
    });

    return cardId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `custody_cards/${cardId}`);
    throw error;
  }
}

export async function deleteCustodyRecord(cardId: string): Promise<void> {
  const cardRef = doc(db, 'custody_cards', cardId);
  try {
    await deleteDoc(cardRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `custody_cards/${cardId}`);
    throw error;
  }
}

export function watchCustodyCards(
  onData: (cards: CustodyRecord[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'custody_cards');
  if (scope?.accessControlEnabled === true) {
    const groups: { field: 'officeId' | 'warehouseId'; ids: string[] }[] = [];
    const offices = [...new Set(scope.officeIds || [])].filter(Boolean);
    const warehouses = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    for (let i = 0; i < offices.length; i += 30) groups.push({ field: 'officeId', ids: offices.slice(i, i + 30) });
    for (let i = 0; i < warehouses.length; i += 30) groups.push({ field: 'warehouseId', ids: warehouses.slice(i, i + 30) });
    if (!groups.length) { onData([]); return () => undefined; }
    const snapshots = new Map<string, Map<string, CustodyRecord>>();
    const unsubs = groups.map(({ field, ids }) => onSnapshot(
      query(ref, where(field, 'in', ids), orderBy('assignedAt', 'desc')),
      (snapshot) => {
        snapshots.set(field + ':' + ids.join(','), new Map(snapshot.docs.map((item) => [
          item.id, { id: item.id, ...item.data() } as CustodyRecord,
        ])));
        const merged = new Map<string, CustodyRecord>();
        snapshots.forEach((items) => items.forEach((record, id) => merged.set(id, record)));
        onData([...merged.values()].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt)));
      },
      (error) => { handleFirestoreError(error, OperationType.GET, 'custody_cards'); onError?.(error as Error); }
    ));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }
  return onSnapshot(query(ref, orderBy('assignedAt', 'desc')), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as CustodyRecord[]);
  }, (error) => { handleFirestoreError(error, OperationType.GET, 'custody_cards'); onError?.(error as Error); });
}

export async function addCustodyRecord(
  card: {
    assetId: string;
    employeeName: string;
    officeName: string;
    notes?: string;
  },
  actorUid: string,
  actorName: string
) {
  const cardId = doc(collection(db, 'custody_cards')).id;
  const assetRef = doc(db, 'assets', card.assetId);
  const cardRef = doc(db, 'custody_cards', cardId);

  try {
    await runTransaction(db, async (tx) => {
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الأصل المحدد غير موجود');

      const assetData = assetSnap.data();
      if (assetData.status !== 'available' && assetData.status !== 'returned') {
        throw new Error('الجهاز غير متاح للتسليم أو تم تسليمه مسبقاً');
      }

      const assetLabel = `${assetData.brand || ''} ${assetData.model || ''}`.trim();
      const now = new Date().toISOString();

      const newRecord: CustodyRecord = {
        id: cardId,
        assetId: card.assetId,
        assetLabel,
        employeeName: card.employeeName.trim(),
        officeName: card.officeName.trim(),
        officeId: assetData.officeId || '',
        warehouseId: assetData.warehouseId || '',
        assignedAt: now,
        status: 'active',
        approvalStatus: 'pending',
        notes: card.notes?.trim() || '',
      };

      tx.set(cardRef, newRecord);
      tx.update(assetRef, {
        status: 'assigned',
        officeName: card.officeName.trim(),
      });

      const movementRef = doc(collection(db, 'asset_movements'));
      tx.set(movementRef, {
        assetId: card.assetId,
        officeId: assetData.officeId || '',
        warehouseId: assetData.warehouseId || '',
        assetLabel,
        movementType: 'assigned',
        toEmployee: card.employeeName.trim(),
        toOffice: card.officeName.trim(),
        occurredAt: now,
        custodyId: cardId,
        notes: card.notes?.trim() || `تسليم عهدة جديدة بواسطة ${actorName || actorUid}`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `custody_cards/${cardId}`);
  }
}

export async function approveCustodyRecord(
  card: CustodyRecord,
  approverUid: string,
  approverName: string
) {
  const cardRef = doc(db, 'custody_cards', card.id);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(cardRef);
      if (!snap.exists()) throw new Error('بطاقة العهدة غير موجودة');

      const data = snap.data() as CustodyRecord;
      if (data.status !== 'active' || data.approvalStatus !== 'pending') {
        throw new Error('بطاقة العهدة ليست بانتظار الاعتماد');
      }
      if (!data.assetId) throw new Error('بطاقة العهدة غير مرتبطة بمعرّف أصل');

      const assetRef = doc(db, 'assets', data.assetId);
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الأصل المرتبط بالعهدة غير موجود');
      if (assetSnap.data().status !== 'assigned') {
        throw new Error('الأصل لم يعد في حالة تسليم؛ لا يمكن اعتماد العهدة قبل مراجعة حالته');
      }

      const now = new Date().toISOString();
      tx.update(cardRef, {
        approvalStatus: 'approved',
        approvedBy: approverName || approverUid,
        approvedAt: now,
      });

      const movement = doc(collection(db, 'asset_movements'));
      tx.set(movement, {
        assetId: data.assetId,
        officeId: data.officeId || '',
        warehouseId: data.warehouseId || '',
        assetLabel: data.assetLabel,
        movementType: 'custody_approved',
        toEmployee: data.employeeName,
        toOffice: data.officeName,
        occurredAt: now,
        custodyId: card.id,
        notes: `تم اعتماد العهدة بواسطة ${approverName || approverUid}`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `custody_cards/${card.id}`);
  }
}

export async function rejectCustodyRecord(
  card: CustodyRecord,
  approverUid: string,
  reason: string,
  approverName: string
) {
  const cardRef = doc(db, 'custody_cards', card.id);

  try {
    await runTransaction(db, async (tx) => {
      const cardSnap = await tx.get(cardRef);
      if (!cardSnap.exists()) throw new Error('بطاقة العهدة غير موجودة');

      const data = cardSnap.data() as CustodyRecord;
      if (data.status !== 'active' || data.approvalStatus !== 'pending') {
        throw new Error('بطاقة العهدة ليست بانتظار الاعتماد');
      }
      if (!data.assetId) throw new Error('بطاقة العهدة غير مرتبطة بمعرّف أصل');

      const assetRef = doc(db, 'assets', data.assetId);
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الأصل المرتبط بالعهدة غير موجود');
      if (assetSnap.data().status !== 'assigned') {
        throw new Error('حالة الأصل لا تشير إلى عهدة نشطة؛ راجع سجل الأصل قبل رفض العهدة');
      }

      tx.update(assetRef, { status: 'available' });

      const now = new Date().toISOString();
      tx.update(cardRef, {
        status: 'rejected',
        approvalStatus: 'rejected',
        rejectedBy: approverName || approverUid,
        rejectedAt: now,
        rejectionReason: reason.trim() || 'رفض بطاقة العهدة',
      });

      const movement = doc(collection(db, 'asset_movements'));
      tx.set(movement, {
        assetId: data.assetId,
        officeId: data.officeId || '',
        warehouseId: data.warehouseId || '',
        assetLabel: data.assetLabel || 'بطاقة عهدة',
        movementType: 'custody_rejected',
        fromEmployee: data.responsibleName || data.employeeName,
        occurredAt: now,
        custodyId: card.id,
        notes: `سبب الرفض: ${reason.trim()} (بواسطة ${approverName || approverUid})`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `custody_cards/${card.id}`);
  }
}

export async function returnCustodyRecord(
  card: CustodyRecord,
  actorUid: string,
  actorName: string
) {
  const cardRef = doc(db, 'custody_cards', card.id);

  try {
    await runTransaction(db, async (tx) => {
      const cardSnap = await tx.get(cardRef);
      if (!cardSnap.exists()) throw new Error('بطاقة العهدة غير موجودة');
      const data = cardSnap.data() as CustodyRecord;
      if (data.status !== 'active') throw new Error('لا يمكن إرجاع عهدة مغلقة أو مُعادة مسبقاً');
      if (data.approvalStatus !== 'approved') throw new Error('لا يمكن إرجاع عهدة لم يتم اعتمادها');
      if (!data.assetId) throw new Error('بطاقة العهدة غير مرتبطة بمعرّف أصل');

      const assetRef = doc(db, 'assets', data.assetId);
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الأصل المرتبط بالعهدة غير موجود');
      if (assetSnap.data().status !== 'assigned') {
        throw new Error('حالة الأصل لا تشير إلى عهدة نشطة؛ راجع سجل الأصل قبل الإرجاع');
      }

      const now = new Date().toISOString();
      tx.update(assetRef, { status: 'available' });

      tx.update(cardRef, {
        status: 'returned',
        returnedAt: now,
      });

      const movement = doc(collection(db, 'asset_movements'));
      tx.set(movement, {
        assetId: data.assetId,
        assetLabel: data.assetLabel || 'بطاقة عهدة',
        movementType: 'returned',
        fromEmployee: data.responsibleName || data.employeeName,
        fromOffice: data.officeName,
        occurredAt: now,
        custodyId: card.id,
        notes: `إرجاع عهدة للمستودع بواسطة ${actorName || actorUid}`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `custody_cards/${card.id}`);
  }
}

export async function transferCustodyRecord(
  card: CustodyRecord,
  newEmployeeName: string,
  newOfficeName: string,
  notes: string = '',
  actorUid: string,
  actorName: string
) {
  const employeeName = newEmployeeName.trim();
  const officeName = newOfficeName.trim();
  if (!employeeName) throw new Error('اسم الموظف الجديد مطلوب');
  if (!officeName) throw new Error('اسم المكتب الجديد مطلوب');

  const cardRef = doc(db, 'custody_cards', card.id);

  try {
    await runTransaction(db, async (tx) => {
      const cardSnap = await tx.get(cardRef);
      if (!cardSnap.exists()) throw new Error('بطاقة العهدة غير موجودة');

      const data = cardSnap.data() as CustodyRecord;
      if (data.status !== 'active') throw new Error('لا يمكن نقل بطاقة عهدة مغلقة');
      if (data.approvalStatus !== 'approved') throw new Error('لا يمكن نقل عهدة قبل اعتمادها');
      if (!data.assetId) throw new Error('بطاقة العهدة غير مرتبطة بمعرّف أصل');

      const assetRef = doc(db, 'assets', data.assetId);
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) throw new Error('الأصل المرتبط بالعهدة غير موجود');
      if (assetSnap.data().status !== 'assigned') {
        throw new Error('الأصل ليس في حالة عهدة نشطة؛ راجع سجل الأصل قبل نقل العهدة');
      }

      const now = new Date().toISOString();
      tx.update(assetRef, {
        officeName,
      });

      tx.update(cardRef, {
        responsibleName: employeeName,
        employeeName,
        officeName,
        transferredAt: now,
      });

      const movement = doc(collection(db, 'asset_movements'));
      tx.set(movement, {
        assetId: data.assetId || card.id,
        officeId: data.officeId || '',
        warehouseId: data.warehouseId || '',
        assetLabel: data.assetLabel || 'بطاقة عهدة',
        movementType: 'custody_transferred',
        fromEmployee: data.responsibleName || data.employeeName,
        toEmployee: newEmployeeName.trim(),
        fromOffice: data.officeName,
        toOffice: newOfficeName.trim(),
        occurredAt: now,
        custodyId: card.id,
        notes: notes.trim() || `نقل عهدة بواسطة ${actorName || actorUid}`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `custody_cards/${card.id}`);
  }
}
