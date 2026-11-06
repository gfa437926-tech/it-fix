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
import { UserPermission, UserProfile } from '../types';

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
        // Newly provisioned accounts are least-privilege until explicitly scoped.
        accessControlEnabled: true,
        permissions: {},
        officeIds: [],
        warehouseIds: [],
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('يوجد ملف مستخدم')) throw error;
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

/**
 * Enable or update explicit RBAC scope for a user. Enabling this flag causes
 * Firestore rules to stop applying the legacy IT-manager fallback immediately.
 */
export async function updateUserAccessScope(
  uid: string,
  access: {
    officeIds: string[];
    warehouseIds: string[];
    permissions: Partial<Record<UserPermission, boolean>>;
  }
) {
  const officeIds = [...new Set(access.officeIds.map((id) => id.trim()).filter(Boolean))];
  const warehouseIds = [...new Set(access.warehouseIds.map((id) => id.trim()).filter(Boolean))];
  const permissions = Object.fromEntries(
    Object.entries(access.permissions).filter(([key, value]) =>
      value === true && [
        'assets.read', 'assets.create', 'assets.update', 'assets.delete',
        'offices.read', 'offices.manage', 'warehouses.read', 'warehouses.manage',
        'custody.read', 'custody.manage', 'maintenance.read', 'maintenance.manage',
        'reports.read', 'users.manage',
      ].includes(key)
    )
  );

  if (officeIds.length === 0 && warehouseIds.length === 0) {
    throw new Error('يجب إسناد مكتب واحد أو مستودع واحد على الأقل قبل تفعيل الصلاحيات المقيدة');
  }

  const ref = doc(db, 'users', uid);
  try {
    await updateDoc(ref, {
      accessControlEnabled: true,
      officeIds,
      warehouseIds,
      permissions,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    throw error;
  }
}

