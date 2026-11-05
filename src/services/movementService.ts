import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AssetMovement } from '../types';

export function watchAssetMovements(
  count: number = 50,
  onData: (movements: AssetMovement[]) => void,
  onError?: (err: Error) => void
) {
  const ref = collection(db, 'asset_movements');
  const q = query(ref, orderBy('occurredAt', 'desc'), limit(count));

  return onSnapshot(
    q,
    (snapshot) => {
      const movements = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as AssetMovement[];
      onData(movements);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'asset_movements');
      onError?.(error as Error);
    }
  );
}
