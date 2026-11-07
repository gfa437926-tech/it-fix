import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { buildAssignedScopeConstraintGroups } from './scopedQueries';
import { AssetMovement, UserProfile } from '../types';

export function watchAssetMovements(
  count: number = 50,
  onData: (movements: AssetMovement[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'asset_movements');
  if (scope?.accessControlEnabled === true) {
    const groups = buildAssignedScopeConstraintGroups(scope.officeIds || [], scope.warehouseIds || []);
    if (!groups.length) { onData([]); return () => undefined; }
    const snapshots = new Map<string, Map<string, AssetMovement>>();
    const unsubs = groups.map(({ key, constraints }) => onSnapshot(
      query(ref, ...constraints, orderBy('occurredAt', 'desc'), limit(count)),
      (snapshot) => {
        snapshots.set(key, new Map(snapshot.docs.map((item) => [
          item.id, { id: item.id, ...item.data() } as AssetMovement,
        ])));
        const merged = new Map<string, AssetMovement>();
        snapshots.forEach((items) => items.forEach((movement, id) => merged.set(id, movement)));
        onData([...merged.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, count));
      },
      (error) => { handleFirestoreError(error, OperationType.GET, 'asset_movements'); onError?.(error as Error); }
    ));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }
  return onSnapshot(query(ref, orderBy('occurredAt', 'desc'), limit(count)), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AssetMovement[]);
  }, (error) => { handleFirestoreError(error, OperationType.GET, 'asset_movements'); onError?.(error as Error); });
}
