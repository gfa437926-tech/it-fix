import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
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
  const uid = user.uid.trim();
  const displayName = user.displayName.trim();
  const email = user.email.trim().toLowerCase();
  if (!uid || !displayName || !email) {
    throw new Error('UID والاسم والبريد الإلكتروني حقول مطلوبة');
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    throw new Error('صيغة البريد الإلكتروني غير صحيحة');
  }

  const ref = doc(db, 'users', uid);
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) {
        throw new Error('يوجد ملف مستخدم بهذا UID بالفعل؛ لم يتم استبدال بياناته');
      }
      const now = new Date().toISOString();
      transaction.set(ref, {
        uid,
        displayName,
        email,
        role: user.role,
        isActive: user.isActive,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('يوجد ملف مستخدم')) throw error;
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}
