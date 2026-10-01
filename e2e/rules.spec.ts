/**
 * Firestore rules, exercised with the real client SDK as each test user.
 * These bypass the UI entirely, so they prove the server-side matrix in firestore.rules.
 */
import { expect, test } from '@playwright/test';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc, deleteDoc,
  addDoc, collection, type Firestore,
} from 'firebase/firestore';
import { CREDS, TOUR_IDS, adminDb, getTour, type Role } from './helpers';

const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

let seq = 0;
interface Client { app: FirebaseApp; db: Firestore; uid: string }

async function clientFor(role: Role | 'anonymous'): Promise<Client> {
  const app = initializeApp(CONFIG, `rules-${role}-${seq++}`);
  const auth = getAuth(app);
  let uid = '';
  if (role === 'anonymous') {
    await signOut(auth).catch(() => {});
  } else {
    const cred = await signInWithEmailAndPassword(auth, CREDS[role].email, CREDS[role].password);
    uid = cred.user.uid;
  }
  return { app, db: getFirestore(app), uid };
}

const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission|insufficient/i);

/** A pending and a confirmed registration the rules tests can poke at. */
async function seedRegs() {
  const base = {
    name: 'Rules Probe', email: `e2e+rules${Date.now()}@tour.test`, phone: '0501234567',
    tourId: TOUR_IDS.aramco, tourName: (await getTour(TOUR_IDS.aramco)).name, slot: 'morning',
    busNumber: null, flag: null, createdAt: new Date(), updatedAt: new Date(), updatedBy: 'visitor',
  };
  const pending = `ZZP${String(Date.now()).slice(-3)}`;
  const confirmed = `ZZC${String(Date.now()).slice(-3)}`;
  await adminDb().collection('registrations').doc(pending).set({ ...base, status: 'pending' });
  await adminDb().collection('registrations').doc(confirmed).set({ ...base, status: 'confirmed' });
  return { pending, confirmed };
}

test.describe('Firestore rules', () => {
  test('anonymous users cannot create registrations or read anything private', async () => {
    const anon = await clientFor('anonymous');

    await denied(setDoc(doc(anon.db, 'registrations', 'ANONYM'), { name: 'Hacker', status: 'confirmed' }));
    await denied(getDoc(doc(anon.db, 'registrations', 'ANONYM')));
    await denied(getDoc(doc(anon.db, 'admins', 'someone')));
    await denied(addDoc(collection(anon.db, 'auditLogs'), { action: 'forged' }));
    await denied(setDoc(doc(anon.db, 'mail', 'x'), { to: 'a@b.c' }));

    // Tours stay publicly readable - the form needs them - but not writable.
    await expect(getDoc(doc(anon.db, 'tours', TOUR_IDS.aramco))).resolves.toBeTruthy();
    await denied(updateDoc(doc(anon.db, 'tours', TOUR_IDS.aramco), { capacity: 9999 }));

    await deleteApp(anon.app);
  });

  test('crowd cannot touch a pending registration, nor change name or email', async () => {
    const { pending, confirmed } = await seedRegs();
    const crowd = await clientFor('crowd');

    // Pending is not theirs to move.
    await denied(updateDoc(doc(crowd.db, 'registrations', pending), {
      status: 'confirmed', updatedAt: serverTimestamp(), updatedBy: CREDS.crowd.email,
    }));

    // Identity fields are off limits even on a confirmed row.
    await denied(updateDoc(doc(crowd.db, 'registrations', confirmed), {
      name: 'Renamed By Crowd', updatedAt: serverTimestamp(), updatedBy: CREDS.crowd.email,
    }));
    await denied(updateDoc(doc(crowd.db, 'registrations', confirmed), {
      email: 'crowd-changed@tour.test', updatedAt: serverTimestamp(), updatedBy: CREDS.crowd.email,
    }));
    await denied(updateDoc(doc(crowd.db, 'registrations', confirmed), {
      status: 'checked_in', name: 'Sneaky', updatedAt: serverTimestamp(), updatedBy: CREDS.crowd.email,
    }));

    // The legitimate move is allowed.
    await expect(updateDoc(doc(crowd.db, 'registrations', confirmed), {
      status: 'checked_in', checkedInAt: serverTimestamp(),
      updatedAt: serverTimestamp(), updatedBy: CREDS.crowd.email,
    })).resolves.toBeUndefined();

    // Crowd may not delete, nor cancel.
    await denied(deleteDoc(doc(crowd.db, 'registrations', confirmed)));
    await denied(updateDoc(doc(crowd.db, 'registrations', confirmed), {
      status: 'cancelled', updatedAt: serverTimestamp(), updatedBy: CREDS.crowd.email,
    }));

    await deleteApp(crowd.app);
    await adminDb().collection('registrations').doc(pending).delete();
    await adminDb().collection('registrations').doc(confirmed).delete();
  });

  test('registration may only change registeredCount on tours', async () => {
    const reg = await clientFor('registration');
    const before = await getTour(TOUR_IDS.aramco);

    // The one allowed field.
    await expect(updateDoc(doc(reg.db, 'tours', TOUR_IDS.aramco), {
      registeredCount: before.registeredCount,
    })).resolves.toBeUndefined();

    // Everything else is refused.
    await denied(updateDoc(doc(reg.db, 'tours', TOUR_IDS.aramco), { capacity: 999 }));
    await denied(updateDoc(doc(reg.db, 'tours', TOUR_IDS.aramco), { active: false }));
    await denied(updateDoc(doc(reg.db, 'tours', TOUR_IDS.aramco), { pickupPoint: 'Nowhere' }));
    await denied(updateDoc(doc(reg.db, 'tours', TOUR_IDS.aramco), {
      registeredCount: before.registeredCount, capacity: 999, // allowed + forbidden together
    }));
    await denied(setDoc(doc(reg.db, 'tours', 'reg-invented-tour'), {
      name: 'Invented', slot: 'morning', capacity: 1, registeredCount: 0, active: true, order: 99,
    }));
    await denied(deleteDoc(doc(reg.db, 'tours', TOUR_IDS.aramco)));

    await deleteApp(reg.app);
  });

  test('non-PO users cannot write admins', async () => {
    const po = await clientFor('po');
    // Only ever re-role the throwaway crowd account, never the real PO/PM logins.
    const target = (await adminDb().collection('admins')
      .where('email', '==', CREDS.crowd.email).get()).docs[0].id;

    for (const role of ['pm', 'registration', 'crowd'] as Role[]) {
      const c = await clientFor(role);
      await denied(updateDoc(doc(c.db, 'admins', target), { role: 'po' }));
      await denied(setDoc(doc(c.db, 'admins', 'invented-uid'), { email: 'x@y.z', name: 'X', role: 'po' }));
      await denied(deleteDoc(doc(c.db, 'admins', target)));
      // But they may read their own doc and the team list (they are admins).
      await expect(getDoc(doc(c.db, 'admins', c.uid))).resolves.toBeTruthy();
      await deleteApp(c.app);
    }

    // The PO can.
    await expect(updateDoc(doc(po.db, 'admins', target), { role: 'crowd' })).resolves.toBeUndefined();
    await deleteApp(po.app);
  });

  test('auditLogs record the real uid and role, and can never be edited or deleted', async () => {
    const crowd = await clientFor('crowd');
    const adminDoc = await adminDb().collection('admins').doc(crowd.uid).get();
    expect(adminDoc.data()?.role).toBe('crowd');

    // A truthful entry is accepted.
    const ref = await addDoc(collection(crowd.db, 'auditLogs'), {
      action: 'status:checked_in', regId: 'RULES1', detail: null,
      byUid: crowd.uid, byEmail: CREDS.crowd.email, byRole: 'crowd', at: serverTimestamp(),
    });
    const written = await adminDb().collection('auditLogs').doc(ref.id).get();
    expect(written.data()).toMatchObject({ byUid: crowd.uid, byRole: 'crowd' });

    // Lying about who you are is refused.
    await denied(addDoc(collection(crowd.db, 'auditLogs'), {
      action: 'forged', regId: 'RULES1', byUid: 'someone-else',
      byEmail: CREDS.crowd.email, byRole: 'crowd', at: serverTimestamp(),
    }));
    await denied(addDoc(collection(crowd.db, 'auditLogs'), {
      action: 'forged', regId: 'RULES1', byUid: crowd.uid,
      byEmail: CREDS.crowd.email, byRole: 'po', at: serverTimestamp(), // not their role
    }));

    // Append-only.
    await denied(updateDoc(doc(crowd.db, 'auditLogs', ref.id), { action: 'tampered' }));
    await denied(deleteDoc(doc(crowd.db, 'auditLogs', ref.id)));

    // Crowd cannot read the trail; PO/PM can.
    await denied(getDoc(doc(crowd.db, 'auditLogs', ref.id)));
    const pm = await clientFor('pm');
    await expect(getDoc(doc(pm.db, 'auditLogs', ref.id))).resolves.toBeTruthy();

    await deleteApp(crowd.app);
    await deleteApp(pm.app);
    await adminDb().collection('auditLogs').doc(ref.id).delete();
  });
});
