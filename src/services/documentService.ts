import {
  collection,
  doc,
  onSnapshot,
  deleteDoc,
  query,
  orderBy,
  where,
  getDoc,
  runTransaction,
  QueryConstraint,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { buildAssignedScopeConstraintGroups } from './scopedQueries';
import { AssetDocument, DocumentType, UserProfile } from '../types';

export function watchAssetDocuments(
  assetId?: string,
  onData?: (docs: AssetDocument[]) => void,
  onError?: (err: Error) => void,
  scope?: UserProfile | null
) {
  const ref = collection(db, 'asset_documents');
  if (scope?.accessControlEnabled === true) {
    const groups = buildAssignedScopeConstraintGroups(scope.officeIds || [], scope.warehouseIds || []);
    if (!groups.length) { onData?.([]); return () => undefined; }
    const snapshots = new Map<string, Map<string, AssetDocument>>();
    const unsubs = groups.map(({ key, constraints: scopeConstraints }) => {
      const constraints: QueryConstraint[] = [...scopeConstraints];
      if (assetId) constraints.push(where('assetId', '==', assetId));
      constraints.push(orderBy('createdAt', 'desc'));
      return onSnapshot(
        query(ref, ...constraints),
        (snapshot) => {
          snapshots.set(key, new Map(snapshot.docs.map((item) => [
            item.id, { id: item.id, ...item.data() } as AssetDocument,
          ])));
          const merged = new Map<string, AssetDocument>();
          snapshots.forEach((items) => items.forEach((document, id) => merged.set(id, document)));
          onData?.([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        },
        (error) => { handleFirestoreError(error, OperationType.GET, 'asset_documents'); onError?.(error as Error); }
      );
    });
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }
  const q = assetId
    ? query(ref, where('assetId', '==', assetId))
    : query(ref, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    onData?.(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AssetDocument[]);
  }, (error) => { handleFirestoreError(error, OperationType.GET, 'asset_documents'); onError?.(error as Error); });
}

export async function uploadAssetDocument(
  file: File,
  assetId: string,
  documentType: DocumentType,
  uploadedBy: string,
  purchaseRecordId?: string
) {
  const docId = doc(collection(db, 'asset_documents')).id;
  const storagePath = `asset_documents/${assetId}/${Date.now()}_${file.name}`;
  let downloadUrl = '';

  try {
    const assetSnap = await getDoc(doc(db, 'assets', assetId));
    if (!assetSnap.exists()) throw new Error('الأصل المرتبط بالمستند غير موجود');
    try {
      const storageRef = ref(storage, storagePath);
      const snapshot = await uploadBytes(storageRef, file, {
        contentType: file.type || 'application/octet-stream',
      });
      downloadUrl = await getDownloadURL(snapshot.ref);
    } catch (storageErr) {
      console.warn('Storage upload fallback:', storageErr);
      // Create data URL fallback if storage bucket has permissions or is unconfigured
      downloadUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    }

    // Read the asset and write its document metadata in one transaction.
    // If a transfer commits while the file is uploading, Firestore retries this
    // transaction and the document receives the asset's new scope, not stale IDs.
    await runTransaction(db, async (transaction) => {
      const currentAssetSnap = await transaction.get(doc(db, 'assets', assetId));
      if (!currentAssetSnap.exists()) {
        throw new Error('الأصل المرتبط بالمستند لم يعد موجوداً');
      }
      const currentAsset = currentAssetSnap.data();
      const docRecord: AssetDocument = {
        id: docId,
        assetId,
        officeId: currentAsset.officeId || '',
        warehouseId: currentAsset.warehouseId || '',
        purchaseRecordId: purchaseRecordId || '',
        fileName: file.name,
        documentType,
        storagePath,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        uploadedBy,
        createdAt: new Date().toISOString(),
        downloadUrl,
      };

      transaction.set(doc(db, 'asset_documents', docId), docRecord);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `asset_documents/${docId}`);
  }
}

export async function deleteAssetDocument(docId: string) {
  try {
    await deleteDoc(doc(db, 'asset_documents', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `asset_documents/${docId}`);
  }
}
