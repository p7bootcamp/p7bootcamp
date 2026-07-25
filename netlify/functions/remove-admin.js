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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const fbAdmin = getAdmin();
  const access = await verifyAdminAccess(event, fbAdmin);
  if (!access.ok || access.role !== 'master') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the main admin can remove admins.' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const token = (data.token || '').trim();
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing token.' }) };
  }

  const db = getDb(fbAdmin);

  try {
    await db.collection('admin_invites').doc(token).update({
      status: 'removed',
      respondedAt: fbAdmin.firestore.FieldValue.serverTimestamp(),
    });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Remove admin failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not remove admin.' }) };
  }
};
