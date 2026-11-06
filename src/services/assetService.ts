import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
  getDocs,
  serverTimestamp,
  addDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Asset, AssetStatus, Office, UserProfile } from '../types';

function normalizeSerial(serial: string): string {
  return serial.trim().toUpperCase();
}

function serialToDocId(serial: string): string {
  // Safe document ID from serial
  try {
    return btoa(unescape(encodeURIComponent(normalizeSerial(serial))))
      .replace(/=/g, '')
      .replace(/\//g, '_')
      .replace(/\+/g, '-');
  } catch {
    return normalizeSerial(serial).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

export function watchAssets(
  onData: (assets: Asset[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const assetsRef = collection(db, 'assets');

  // Firestore rules are not filters. Scoped users must issue queries whose
  // predicates prove that every returned asset belongs to an assigned office
  // or warehouse; otherwise Firestore correctly rejects the entire query.
  if (scope?.accessControlEnabled === true) {
    const officeIds = [...new Set(scope.officeIds || [])].filter(Boolean);
    const warehouseIds = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    const groups: { field: 'officeId' | 'warehouseId'; ids: string[] }[] = [];
    for (let i = 0; i < officeIds.length; i += 30) {
      groups.push({ field: 'officeId', ids: officeIds.slice(i, i + 30) });
    }
    for (let i = 0; i < warehouseIds.length; i += 30) {
      groups.push({ field: 'warehouseId', ids: warehouseIds.slice(i, i + 30) });
    }

    if (groups.length === 0) {
      onData([]);
      return () => undefined;
    }

    const snapshots = new Map<string, Asset>();
    const unsubs = groups.map(({ field, ids }) =>
      onSnapshot(
        query(assetsRef, where(field, 'in', ids)),
        (snapshot) => {
          // Rebuild from all active query snapshots to remove records that
          // moved outside this user's assigned scope.
          const current = new Map<string, Asset>();
          for (const docSnap of snapshot.docs) {
            current.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as Asset);
          }
          snapshots.set(field + ':' + ids.join(','), current as unknown as Asset);
          const merged = new Map<string, Asset>();
          for (const value of snapshots.values()) {
            if (value instanceof Map) {
              for (const [id, asset] of value.entries()) merged.set(id, asset);
            }
          }
          onData([...merged.values()].sort((a, b) => a.brand.localeCompare(b.brand)));
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, 'assets');
          onError?.(error as Error);
        }
      )
    );

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  const q = query(assetsRef, orderBy('brand', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const assets = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as Asset[];
      onData(assets);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'assets');
      onError?.(error as Error);
    }
  );
}

export async function createAsset(asset: Omit<Asset, 'id'> & { id?: string }, actorName: string = '') {
  const assetId = asset.id || doc(collection(db, 'assets')).id;
  const serial = normalizeSerial(asset.serialNumber);

  try {
    await runTransaction(db, async (tx) => {
      const assetRef = doc(db, 'assets', assetId);
      const assetSnap = await tx.get(assetRef);
      if (assetSnap.exists()) {
        throw new Error('معرف الأصل مستخدم مسبقاً');
      }

      let serialRef = null;
      if (serial) {
        serialRef = doc(db, 'asset_serials', serialToDocId(serial));
        const serialSnap = await tx.get(serialRef);
        if (serialSnap.exists()) {
          throw new Error(`الرقم التسلسلي (${serial}) مسجل مسبقاً لجهاز آخر`);
        }
      }

      const assetData = {
        ...asset,
        id: assetId,
        serialNumber: serial,
        receivedAt: asset.receivedAt || new Date().toISOString(),
      };

      tx.set(assetRef, assetData);

      if (serialRef) {
        tx.set(serialRef, {
          assetId,
          serialNumber: serial,
          createdAt: new Date().toISOString(),
        });
      }

      // Record movement
      const movementRef = doc(collection(db, 'asset_movements'));
      tx.set(movementRef, {
        assetId,
        assetLabel: `${asset.brand} ${asset.model}`.trim(),
        movementType: 'created',
        toOffice: asset.officeName || 'المستودع الرئيسي',
        toOfficeName: asset.officeName || 'المستودع الرئيسي',
        toOfficeId: asset.officeId || '',
        occurredAt: new Date().toISOString(),
        notes: `إضافة أصل جديد بواسطة ${actorName || 'المسؤول'}`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `assets/${assetId}`);
  }
}

export async function updateAsset(asset: Asset) {
  const serial = normalizeSerial(asset.serialNumber);
  const assetRef = doc(db, 'assets', asset.id);

  try {
    await runTransaction(db, async (tx) => {
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists()) {
        throw new Error('الجهاز المراد تعديله غير موجود');
      }

      const oldData = assetSnap.data();
      const oldSerial = normalizeSerial(oldData.serialNumber || '');
      const serialChanged = oldSerial !== serial;

      let oldSerialRef = null;
      let newSerialRef = null;

      if (oldSerial && serialChanged) {
        oldSerialRef = doc(db, 'asset_serials', serialToDocId(oldSerial));
      }

      if (serial) {
        newSerialRef = doc(db, 'asset_serials', serialToDocId(serial));
        const newSerialSnap = await tx.get(newSerialRef);
        if (newSerialSnap.exists() && newSerialSnap.data().assetId !== asset.id) {
          throw new Error(`الرقم التسلسلي (${serial}) مسجل لجهاز آخر`);
        }
      }

      // Read the previous reservation before writes; remove it only if it still
      // belongs to this asset, so a stale/corrupt index cannot erase another
      // asset's serial reservation.
      let mayDeleteOldReservation = false;
      if (serialChanged && oldSerialRef) {
        const oldSerialSnap = await tx.get(oldSerialRef);
        mayDeleteOldReservation =
          oldSerialSnap.exists() && oldSerialSnap.data().assetId === asset.id;
      }

      tx.update(assetRef, {
        ...asset,
        serialNumber: serial,
      });

      if (mayDeleteOldReservation && oldSerialRef) {
        tx.delete(oldSerialRef);
      }

      if (newSerialRef) {
        tx.set(newSerialRef, {
          assetId: asset.id,
          serialNumber: serial,
          updatedAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `assets/${asset.id}`);
  }
}

export async function transferAsset(
  asset: Asset,
  destination: Office,
  notes: string = '',
  actorName: string = ''
) {
  const assetRef = doc(db, 'assets', asset.id);
  const officeRef = doc(db, 'offices', destination.id);

  try {
    await runTransaction(db, async (tx) => {
      const assetSnap = await tx.get(assetRef);
      const officeSnap = await tx.get(officeRef);

      if (!assetSnap.exists()) throw new Error('الجهاز غير موجود');
      if (!officeSnap.exists() || !officeSnap.data().isActive) {
        throw new Error('المكتب الوجهة غير موجود أو غير فعال');
      }

      const currentStatus = assetSnap.data().status as AssetStatus;
      if (currentStatus !== 'available' && currentStatus !== 'returned') {
        throw new Error('لا يمكن نقل الجهاز إلا إذا كان متاحاً وغير مرتبط بعهدة نشطة أو صيانة');
      }

      const fromOfficeId = assetSnap.data().officeId || '';
      const fromOfficeName = assetSnap.data().officeName || 'غير محدد';

      if (fromOfficeId === destination.id) {
        throw new Error('الجهاز موجود بالفعل في هذا المكتب');
      }

      const now = new Date().toISOString();

      tx.update(assetRef, {
        officeId: destination.id,
        officeName: destination.name,
        transferredAt: now,
      });

      const movementRef = doc(collection(db, 'asset_movements'));
      tx.set(movementRef, {
        assetId: asset.id,
        assetLabel: `${asset.brand} ${asset.model}`.trim(),
        movementType: 'transferred',
        occurredAt: now,
        fromOffice: fromOfficeName,
        fromOfficeId,
        fromOfficeName,
        toOffice: destination.name,
        toOfficeId: destination.id,
        toOfficeName: destination.name,
        notes: notes.trim() || `نقل بواسطة ${actorName || 'المسؤول'}`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `assets/${asset.id}`);
  }
}

export async function retireAsset(asset: Asset, reason: string = '', actorName: string = '') {
  const assetRef = doc(db, 'assets', asset.id);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(assetRef);
      if (!snap.exists()) throw new Error('الجهاز غير موجود');

      const currentStatus = snap.data().status as AssetStatus;
      if (currentStatus === 'retired') throw new Error('الجهاز مستبعد مسبقاً');
      if (currentStatus === 'assigned' || currentStatus === 'maintenance') {
        throw new Error('يجب إغلاق العهدة أو استلام الجهاز من الصيانة قبل استبعاده');
      }

      const now = new Date().toISOString();
      tx.update(assetRef, {
        status: 'retired',
        retiredAt: now,
        retirementReason: reason.trim(),
      });

      const movementRef = doc(collection(db, 'asset_movements'));
      tx.set(movementRef, {
        assetId: asset.id,
        assetLabel: `${asset.brand} ${asset.model}`.trim(),
        movementType: 'retired',
        occurredAt: now,
        notes: `سبب الاستبعاد: ${reason.trim()} (${actorName || 'المسؤول'})`,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `assets/${asset.id}`);
  }
}


/**
 * Persist a physical inventory verification. The record is append-only and
 * intentionally separate from asset movements: checking an item does not
 * change its ownership, location, or operational status.
 */
export async function recordInventoryCheck(
  asset: Asset,
  actor: { uid: string; name: string; email?: string }
): Promise<void> {
  if (!actor.uid) throw new Error('يجب تسجيل الدخول لتوثيق عملية الجرد');
  const checkedAt = new Date().toISOString();

  try {
    await addDoc(collection(db, 'inventory_checks'), {
      assetId: asset.id,
      assetLabel: `${asset.brand} ${asset.model}`.trim(),
      serialNumber: normalizeSerial(asset.serialNumber),
      category: asset.category,
      statusAtCheck: asset.status,
      officeId: asset.officeId || '',
      officeName: asset.officeName || 'المستودع الرئيسي',
      checkedAt,
      checkedByUid: actor.uid,
      checkedByName: actor.name,
      checkedByEmail: actor.email || '',
      method: 'qr_or_serial',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'inventory_checks');
  }
}
