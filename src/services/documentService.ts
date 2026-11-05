import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { AssetDocument, DocumentType } from '../types';

export function watchAssetDocuments(
  assetId?: string,
  onData?: (docs: AssetDocument[]) => void,
  onError?: (err: Error) => void
) {
  const colRef = collection(db, 'asset_documents');
  const q = assetId
    ? query(colRef, where('assetId', '==', assetId))
    : query(colRef, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const docs = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as AssetDocument[];
      onData?.(docs);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'asset_documents');
      onError?.(error as Error);
    }
  );
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

    const docRecord: AssetDocument = {
      id: docId,
      assetId,
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

    await setDoc(doc(db, 'asset_documents', docId), docRecord);
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
