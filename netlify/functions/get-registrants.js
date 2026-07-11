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

exports.handler = async function (event) {
  const suppliedPassword = event.headers['x-admin-password'] || '';

  if (!process.env.ADMIN_DASHBOARD_PASSWORD || suppliedPassword !== process.env.ADMIN_DASHBOARD_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const fbAdmin = getAdmin();
  const db = getDb(fbAdmin);

  try {
    const snapshot = await db.collection('registrations').orderBy('createdAt', 'desc').get();
    const registrants = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        fullName: d.fullName || '',
        email: d.email || '',
        zone: d.zone || '',
        age: d.age || '',
        skill: d.skill || '',
        expectation: d.expectation || '',
        createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
      };
    });
    return { statusCode: 200, body: JSON.stringify({ registrants }) };
  } catch (err) {
    console.error('Fetch failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load registrants.' }) };
  }
};
