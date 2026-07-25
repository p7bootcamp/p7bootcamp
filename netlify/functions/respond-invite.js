const admin = require('firebase-admin');
const { getDb } = require('./lib/auth');

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

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const token = (data.token || '').trim();
  const action = data.action;
  if (!token || !['accept', 'reject'].includes(action)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const fbAdmin = getAdmin();
  const db = getDb(fbAdmin);

  try {
    const ref = db.collection('admin_invites').doc(token);
    const doc = await ref.get();
    if (!doc.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'This invite link is invalid.' }) };
    }
    const invite = doc.data();
    if (invite.status === 'removed') {
      return { statusCode: 403, body: JSON.stringify({ error: 'You have been removed from the admin team.' }) };
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    await ref.update({ status: newStatus, respondedAt: fbAdmin.firestore.FieldValue.serverTimestamp() });

    return { statusCode: 200, body: JSON.stringify({ success: true, status: newStatus, email: invite.email }) };
  } catch (err) {
    console.error('Invite response failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not update invite.' }) };
  }
};
