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
  const token = (event.queryStringParameters && event.queryStringParameters.token) || '';
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing token.' }) };
  }

  const fbAdmin = getAdmin();
  const db = getDb(fbAdmin);

  try {
    const doc = await db.collection('admin_invites').doc(token).get();
    if (!doc.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'This invite link is invalid.' }) };
    }
    const invite = doc.data();
    return {
      statusCode: 200,
      body: JSON.stringify({ name: invite.name || '', email: invite.email, status: invite.status }),
    };
  } catch (err) {
    console.error('Invite check failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not check invite.' }) };
  }
};
