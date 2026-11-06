import { collection, doc, onSnapshot, query, orderBy, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Warehouse } from '../types';

export function watchWarehouses(
  onData: (warehouses: Warehouse[]) => void,
  onError?: (error: Error) => void
) {
  const ref = collection(db, 'warehouses');
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
