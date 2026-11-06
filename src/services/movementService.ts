import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AssetMovement, UserProfile } from '../types';

export function watchAssetMovements(
  count: number = 50,
  onData: (movements: AssetMovement[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'asset_movements');
  if (scope?.accessControlEnabled === true) {
    const groups: { field: 'officeId' | 'warehouseId'; ids: string[] }[] = [];
    const offices = [...new Set(scope.officeIds || [])].filter(Boolean);
    const warehouses = [...new Set(scope.warehouseIds || [])].filter(Boolean);
    for (let i = 0; i < offices.length; i += 30) groups.push({ field: 'officeId', ids: offices.slice(i, i + 30) });
    for (let i = 0; i < warehouses.length; i += 30) groups.push({ field: 'warehouseId', ids: warehouses.slice(i, i + 30) });
    if (!groups.length) { onData([]); return () => undefined; }
    const snapshots = new Map<string, Map<string, AssetMovement>>();
    const unsubs = groups.map(({ field, ids }) => onSnapshot(
      query(ref, where(field, 'in', ids), orderBy('occurredAt', 'desc'), limit(count)),
      (snapshot) => {
        snapshots.set(field + ':' + ids.join(','), new Map(snapshot.docs.map((item) => [
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
