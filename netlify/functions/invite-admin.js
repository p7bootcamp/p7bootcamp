const admin = require('firebase-admin');
const crypto = require('crypto');
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same Brevo template pattern as the 4 bootcamp confirmation emails in register.js —
// set BREVO_TEMPLATE_ADMIN_INVITE in Netlify if you ever want to swap the template later.
const ADMIN_INVITE_TEMPLATE_ID = process.env.BREVO_TEMPLATE_ADMIN_INVITE || 5;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const fbAdmin = getAdmin();
  const access = await verifyAdminAccess(event, fbAdmin);
  if (!access.ok || access.role !== 'master') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the main admin can send invites.' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const name = (data.name || '').trim();
  const email = (data.email || '').trim().toLowerCase();
  if (!name || name.length < 2) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a name.' }) };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  const db = getDb(fbAdmin);
  const token = crypto.randomBytes(24).toString('hex');

  try {
    // Reuse the slot for this email if one already exists (e.g. re-inviting someone
    // who was removed or who never responded) instead of creating duplicate records.
    const existing = await db.collection('admin_invites').where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      await db.collection('admin_invites').doc(existing.docs[0].id).delete();
    }

    await db.collection('admin_invites').doc(token).set({
      name,
      email,
      status: 'pending',
      invitedAt: fbAdmin.firestore.FieldValue.serverTimestamp(),
      respondedAt: null,
    });
  } catch (err) {
    console.error('Invite write failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not create invite.' }) };
  }

  const siteUrl = process.env.URL || 'https://lp7mediabootcamp.netlify.app';
  const inviteLink = `${siteUrl}/admin-invite.html?token=${token}`;

  let emailSent = false;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        to: [{ email, name }],
        templateId: Number(ADMIN_INVITE_TEMPLATE_ID),
        params: {
          NAME: name,
          FIRSTNAME: name.split(' ')[0],
          EMAIL: email,
          ROLE: 'Admin',
          INVITE_LINK: inviteLink,
        },
      }),
    });
    emailSent = res.ok;
    if (!res.ok) console.error('Brevo error:', res.status, await res.text());
  } catch (err) {
    console.error('Brevo request failed:', err);
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, emailSent }) };
};
