const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

function getAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

function getDb(fbAdmin) {
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  return getFirestore(fbAdmin.app(), databaseId);
}

const GMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const email = (data.email || '').trim().toLowerCase();

  if (!GMAIL_PATTERN.test(email)) {
    // Not a valid Gmail address at all — nothing to check, let the normal format
    // validation on the client handle telling the user that.
    return { statusCode: 200, body: JSON.stringify({ registered: false }) };
  }

  const fbAdmin = getAdmin();
  const db = getDb(fbAdmin);

  try {
    const snapshot = await db.collection('registrations').where('email', '==', email).limit(1).get();
    return { statusCode: 200, body: JSON.stringify({ registered: !snapshot.empty }) };
  } catch (err) {
    console.error('Email check failed:', err);
    // Fail open rather than blocking a legitimate registrant over an infrastructure hiccup —
    // register.js still enforces this as a hard duplicate check at submission time.
    return { statusCode: 200, body: JSON.stringify({ registered: false }) };
  }
};
