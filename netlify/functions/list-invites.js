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
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the main admin can view invites.' }) };
  }

  const db = getDb(fbAdmin);

  try {
    const snapshot = await db.collection('admin_invites').orderBy('invitedAt', 'desc').get();
    const invites = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        token: doc.id,
        name: d.name || '',
        email: d.email || '',
        status: d.status || 'pending',
        invitedAt: d.invitedAt && d.invitedAt.toDate ? d.invitedAt.toDate().toISOString() : null,
        respondedAt: d.respondedAt && d.respondedAt.toDate ? d.respondedAt.toDate().toISOString() : null,
      };
    });
    return { statusCode: 200, body: JSON.stringify({ invites }) };
  } catch (err) {
    console.error('List invites failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load invites.' }) };
  }
};
