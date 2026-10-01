// One-line Admin SDK connectivity check: reads at most 1 doc from "tours".
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
dotenv.config({ path: '.env.local' });
dotenv.config();

try {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
  });
  const snap = await getFirestore().collection('tours').limit(1).get();
  console.log(`OK - Admin SDK connected. tours collection currently has ${snap.size === 0 ? 'no' : 'at least 1'} document(s).`);
} catch (e) {
  console.error(`FAILED - ${e.code ?? e.errorInfo?.code ?? 'unknown'}: ${e.message?.split('\n')[0]}`);
  process.exit(1);
}
