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
