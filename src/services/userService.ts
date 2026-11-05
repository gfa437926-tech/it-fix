import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile } from '../types';

export function watchUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (err: Error) => void
) {
  const ref = collection(db, 'users');
  const q = query(ref, orderBy('displayName', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const users = snapshot.docs.map((docSnap) => ({
        uid: docSnap.id,
        ...docSnap.data(),
      })) as UserProfile[];
      onData(users);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
      onError?.(error as Error);
    }
  );
}

export async function updateUserRole(uid: string, role: 'admin' | 'it_manager') {
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      role,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function toggleUserActive(uid: string, isActive: boolean) {
  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      isActive,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function createManualUser(user: {
  uid: string;
  displayName: string;
  email: string;
  role: 'admin' | 'it_manager';
  isActive: boolean;
}) {
  const ref = doc(db, 'users', user.uid);
  try {
    await setDoc(ref, {
      ...user,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}
