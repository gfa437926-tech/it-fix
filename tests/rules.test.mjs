import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { ref, getBytes, uploadBytes } from 'firebase/storage';

const projectId = 'demo-itfix-rbac';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'scoped-user'), {
      uid: 'scoped-user',
      isActive: true,
      role: 'it_manager',
      accessControlEnabled: true,
      officeIds: ['office-a'],
      warehouseIds: ['warehouse-a'],
      permissions: { 'assets.read': true, 'documents.read': true },
    });
    await setDoc(doc(db, 'assets', 'asset-a'), {
      officeId: 'office-a',
      warehouseId: 'warehouse-a',
    });
    await setDoc(doc(db, 'assets', 'asset-wrong-warehouse'), {
      officeId: 'office-a',
      warehouseId: 'warehouse-b',
    });
    await setDoc(doc(db, 'assets', 'asset-wrong-office'), {
      officeId: 'office-b',
      warehouseId: 'warehouse-a',
    });
  });
});

after(async () => {
  await env?.cleanup();
});

test('allows reads when both office and warehouse are assigned', async () => {
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertSucceeds(getDoc(doc(db, 'assets', 'asset-a')));
});

test('allows explicitly office-only records for an assigned office', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'assets', 'office-only'), {
      officeId: 'office-a',
      warehouseId: '',
    });
  });
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertSucceeds(getDoc(doc(db, 'assets', 'office-only')));
});

test('allows explicitly warehouse-only records for an assigned warehouse', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'assets', 'warehouse-only'), {
      officeId: '',
      warehouseId: 'warehouse-a',
    });
  });
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertSucceeds(getDoc(doc(db, 'assets', 'warehouse-only')));
});

test('denies legacy asset records when both scope fields are absent', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'assets', 'legacy-unscoped'), {
      name: 'Legacy asset without scope',
    });
  });
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertFails(getDoc(doc(db, 'assets', 'legacy-unscoped')));
});

test('denies a warehouse outside the assigned warehouse even in the assigned office', async () => {
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertFails(getDoc(doc(db, 'assets', 'asset-wrong-warehouse')));
});

test('allows list queries only when both assigned scope predicates are present', async () => {
  const db = env.authenticatedContext('scoped-user').firestore();
  const safeQuery = query(
    collection(db, 'assets'),
    where('officeId', 'in', ['office-a']),
    where('warehouseId', 'in', ['warehouse-a']),
  );
  const result = await assertSucceeds(getDocs(safeQuery));
  assert.equal(result.size, 1);
  const incompleteQuery = query(
    collection(db, 'assets'),
    where('officeId', 'in', ['office-a']),
  );
  await assertFails(getDocs(incompleteQuery));
});

test('denies an office outside the assigned office even in the assigned warehouse', async () => {
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertFails(getDoc(doc(db, 'assets', 'asset-wrong-office')));
});

test('denies all scoped asset reads when both assignments are empty', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'scoped-user'), {
      uid: 'scoped-user',
      isActive: true,
      role: 'it_manager',
      accessControlEnabled: true,
      officeIds: [],
      warehouseIds: [],
      permissions: { 'assets.read': true },
    });
  });
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertFails(getDoc(doc(db, 'assets', 'asset-a')));
});

test('denies access when the permission is absent even if scope matches', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'scoped-user'), {
      uid: 'scoped-user',
      isActive: true,
      role: 'it_manager',
      accessControlEnabled: true,
      officeIds: ['office-a'],
      warehouseIds: ['warehouse-a'],
      permissions: {},
    });
  });
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertFails(getDoc(doc(db, 'assets', 'asset-a')));
});

test('denies access for an inactive account with otherwise valid scope', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'scoped-user'), {
      uid: 'scoped-user',
      isActive: false,
      role: 'it_manager',
      accessControlEnabled: true,
      officeIds: ['office-a'],
      warehouseIds: ['warehouse-a'],
      permissions: { 'assets.read': true },
    });
  });
  const db = env.authenticatedContext('scoped-user').firestore();
  await assertFails(getDoc(doc(db, 'assets', 'asset-a')));
});

test('Storage access follows the linked asset office AND warehouse scope', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const adminStorage = context.storage();
    for (const assetId of ['asset-a', 'asset-wrong-warehouse']) {
      await uploadBytes(ref(adminStorage, `asset_documents/${assetId}/report.pdf`), new Uint8Array([1, 2, 3]), {
        contentType: 'application/pdf',
      });
    }
  });
  const userStorage = env.authenticatedContext('scoped-user').storage();
  await assertSucceeds(getBytes(ref(userStorage, 'asset_documents/asset-a/report.pdf')));
  await assertFails(getBytes(ref(userStorage, 'asset_documents/asset-wrong-warehouse/report.pdf')));
});
