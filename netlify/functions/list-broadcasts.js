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
  if (!access.ok || access.role !== 'master') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the main admin can view broadcast history.' }) };
  }

  const db = getDb(fbAdmin);

  try {
    const snapshot = await db.collection('broadcasts').orderBy('createdAt', 'desc').limit(50).get();
    const broadcasts = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        target: d.target || '',
        skill: d.skill || null,
        singleEmail: d.singleEmail || null,
        subject: d.subject || '',
        message: d.message || '',
        recipientCount: d.recipientCount || 0,
        sentCount: d.sentCount || 0,
        sentBy: d.sentBy || '',
        createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
      };
    });
    return { statusCode: 200, body: JSON.stringify({ broadcasts }) };
  } catch (err) {
    console.error('List broadcasts failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load broadcast history.' }) };
  }
};
