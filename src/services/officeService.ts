import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Office } from '../types';

export function watchOffices(
  onData: (offices: Office[]) => void,
  onError?: (err: Error) => void
) {
  const ref = collection(db, 'offices');
  const q = query(ref, orderBy('name', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const offices = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as Office[];
      onData(offices);
    },
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
