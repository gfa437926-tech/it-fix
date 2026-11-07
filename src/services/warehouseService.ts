import { collection, doc, onSnapshot, query, orderBy, setDoc, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Warehouse } from '../types';

export function watchWarehouses(
  onData: (warehouses: Warehouse[]) => void,
  onError?: (error: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'warehouses');
  if (scope?.accessControlEnabled === true) {
    const ids = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    if (!ids.length) {
      onData([]);
      return () => undefined;
    }
    const unsubs: (() => void)[] = [];
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const snapshots = new Map<string, Warehouse[]>();
    chunks.forEach((chunk, index) => {
      unsubs.push(onSnapshot(
        query(ref, where('id', 'in', chunk)),
        (snapshot) => {
          snapshots.set(String(index), snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          })) as Warehouse[]);
          onData([...snapshots.values()].flat().sort((a, b) => a.name.localeCompare(b.name)));
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, 'warehouses');
          onError?.(error as Error);
        }
      ));
    });
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }

  return onSnapshot(
    query(ref, orderBy('name', 'asc')),
    (snapshot) => onData(snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as Warehouse[]),
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'warehouses');
      onError?.(error as Error);
    }
  );
}

export async function saveWarehouse(warehouse: Omit<Warehouse, 'id'> & { id?: string }) {
  const id = warehouse.id || doc(collection(db, 'warehouses')).id;
  if (!warehouse.name.trim()) throw new Error('اسم المستودع مطلوب');
  try {
    await setDoc(doc(db, 'warehouses', id), {
      ...warehouse,
      id,
      name: warehouse.name.trim(),
      code: warehouse.code?.trim() || '',
      officeIds: [...new Set((warehouse.officeIds || []).filter(Boolean))],
      notes: warehouse.notes?.trim() || '',
      isActive: warehouse.isActive ?? true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `warehouses/${id}`);
    throw error;
  }
}
