import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Office, UserProfile } from '../types';

export function watchOffices(
  onData: (offices: Office[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'offices');
  if (scope?.accessControlEnabled === true) {
    const groups: { field: 'id' | 'warehouseId'; ids: string[] }[] = [];
    const officeIds = [...new Set(scope.officeIds || [])].filter(Boolean);
    const warehouseIds = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    for (let i = 0; i < officeIds.length; i += 30) groups.push({ field: 'id', ids: officeIds.slice(i, i + 30) });
    for (let i = 0; i < warehouseIds.length; i += 30) groups.push({ field: 'warehouseId', ids: warehouseIds.slice(i, i + 30) });
    if (!groups.length) {
      onData([]);
      return () => undefined;
    }
    const snapshots = new Map<string, Map<string, Office>>();
    const unsubs = groups.map(({ field, ids }) => onSnapshot(
      query(ref, where(field, 'in', ids)),
      (snapshot) => {
        snapshots.set(field + ':' + ids.join(','), new Map(snapshot.docs.map((item) => [
          item.id, { id: item.id, ...item.data() } as Office,
        ])));
        const merged = new Map<string, Office>();
        snapshots.forEach((items) => items.forEach((office, id) => merged.set(id, office)));
        onData([...merged.values()].sort((a, b) => a.name.localeCompare(b.name)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'offices');
        onError?.(error as Error);
      }
    ));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  return onSnapshot(
    query(ref, orderBy('name', 'asc')),
    (snapshot) => onData(snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as Office[]),
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'offices');
      onError?.(error as Error);
    }
  );
}

export async function saveOffice(office: Omit<Office, 'id'> & { id?: string }) {
  const officeId = office.id || doc(collection(db, 'offices')).id;
  const ref = doc(db, 'offices', officeId);

  try {
    await setDoc(ref, {
      ...office,
      id: officeId,
      name: office.name.trim(),
      building: office.building?.trim() || '',
      directorate: office.directorate?.trim() || '',
      department: office.department?.trim() || '',
      room: office.room?.trim() || '',
      manager: office.manager?.trim() || '',
      phone: office.phone?.trim() || '',
      notes: office.notes?.trim() || '',
      isActive: office.isActive ?? true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `offices/${officeId}`);
  }
}

export async function toggleOfficeStatus(officeId: string, isActive: boolean) {
  const ref = doc(db, 'offices', officeId);
  try {
    await updateDoc(ref, { isActive });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `offices/${officeId}`);
  }
}
