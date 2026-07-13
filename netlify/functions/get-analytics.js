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
    // Cap at the most recent 5000 views — plenty for this scale, keeps the dashboard fast.
    const snapshot = await db.collection('pageviews').orderBy('createdAt', 'desc').limit(5000).get();
    const views = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        path: d.path || '/',
        referrer: d.referrer || '',
        visitorId: d.visitorId || '',
        createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
      };
    });
    return { statusCode: 200, body: JSON.stringify({ views }) };
  } catch (err) {
    console.error('Analytics fetch failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load analytics.' }) };
  }
};
