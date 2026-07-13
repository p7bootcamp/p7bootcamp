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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const path = (data.path || '/').slice(0, 200);
  const referrer = (data.referrer || '').slice(0, 500);
  const visitorId = (data.visitorId || '').slice(0, 100);

  if (!visitorId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing visitorId' }) };
  }

  try {
    const fbAdmin = getAdmin();
    const db = getDb(fbAdmin);
    await db.collection('pageviews').add({
      path,
      referrer,
      visitorId,
      createdAt: fbAdmin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Analytics should never be able to break the site for a real visitor —
    // log it server-side and just move on.
    console.error('Pageview write failed:', err);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
