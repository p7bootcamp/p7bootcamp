const admin = require('firebase-admin');
const { verifyAdminAccess, getDb } = require('./lib/auth');

function getAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

exports.handler = async function (event) {
  const fbAdmin = getAdmin();
  const access = await verifyAdminAccess(event, fbAdmin);

  if (!access.ok) {
    const message = access.error === 'removed' ? 'Your admin access has been removed.' : 'Unauthorized';
    return { statusCode: access.statusCode, body: JSON.stringify({ error: message }) };
  }

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
