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

// One shared template for every broadcast, regardless of who it targets.
// Defaults to template 6 (the broadcast template in Brevo) — override with
// BREVO_TEMPLATE_BROADCAST in Netlify if you ever swap templates.
const BROADCAST_TEMPLATE_ID = process.env.BREVO_TEMPLATE_BROADCAST || 6;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SKILLS = [
  'Smartphone Photography & Videography',
  'AI Animation & Video Editing',
  'Graphic Design',
  'Web Development',
];

// Brevo's messageVersions cap: up to 1000 personalized versions per API call.
// One recipient per version (so each person gets their own name/zone), chunked
// well under that ceiling to leave headroom.
const CHUNK_SIZE = 500;

// Turn plain-text admin input into safe, line-broken HTML for the template.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const fbAdmin = getAdmin();
  const access = await verifyAdminAccess(event, fbAdmin);
  if (!access.ok || access.role !== 'master') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the main admin can send broadcasts.' }) };
  }

  if (!process.env.BREVO_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Email sending is not configured.' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const target = (data.target || '').trim(); // 'all' | 'skill' | 'single'
  const skill = (data.skill || '').trim();
  const subject = (data.subject || '').trim();
  const message = (data.message || '').trim();
  const singleName = (data.singleName || '').trim();
  const singleEmail = (data.singleEmail || '').trim().toLowerCase();

  if (!['all', 'skill', 'single'].includes(target)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid target.' }) };
  }
  if (target === 'skill' && !VALID_SKILLS.includes(skill)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please select a valid skill.' }) };
  }
  if (target === 'single' && !EMAIL_PATTERN.test(singleEmail)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }
  if (!subject || subject.length > 150) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a subject (max 150 characters).' }) };
  }
  if (!message || message.length > 5000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a message (max 5000 characters).' }) };
  }

  const db = getDb(fbAdmin);
  // Brevo escapes {{ params.MESSAGE }} itself when it renders the template,
  // so we send the plain text as-is (no manual escaping/<br> conversion —
  // that would get double-escaped). The template preserves line breaks via CSS.

  // Build the recipient list — always pulled fresh from Firestore server-side,
  // never trusted from the client.
  let recipients = [];
  try {
    if (target === 'all') {
      const snap = await db.collection('registrations').get();
      recipients = snap.docs.map((doc) => doc.data());
    } else if (target === 'skill') {
      const snap = await db.collection('registrations').where('skill', '==', skill).get();
      recipients = snap.docs.map((doc) => doc.data());
    } else {
      // Single email — if it matches an existing registrant, pull their real
      // name/zone/skill so the message is still personalized; otherwise fall
      // back to whatever name the admin typed in.
      const existing = await db.collection('registrations').where('email', '==', singleEmail).limit(1).get();
      if (!existing.empty) {
        recipients = [existing.docs[0].data()];
      } else {
        recipients = [{
          fullName: singleName || singleEmail.split('@')[0],
          email: singleEmail,
          zone: '',
          skill: '',
        }];
      }
    }
  } catch (err) {
    console.error('Recipient lookup failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not look up recipients.' }) };
  }

  // De-dupe by email just in case, and drop anything without a usable address.
  const seen = new Set();
  recipients = recipients.filter((r) => {
    const email = (r.email || '').trim().toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });

  if (recipients.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No matching recipients found.' }) };
  }

  const versions = recipients.map((r) => ({
    to: [{ email: r.email, name: r.fullName || r.email }],
    subject, // so the inbox subject line matches what the admin typed, not just the template default
    params: {
      FULLNAME: r.fullName || '',
      FIRSTNAME: (r.fullName || '').split(' ')[0] || '',
      ZONE: r.zone || '',
      SKILL: r.skill || '',
      TITLE: subject,
      MESSAGE: message,
    },
  }));

  let sent = 0;
  const errors = [];

  for (let i = 0; i < versions.length; i += CHUNK_SIZE) {
    const chunk = versions.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          templateId: Number(BROADCAST_TEMPLATE_ID),
          subject, // default/fallback subject; each version overrides via its own params/subject use in template
          params: { TITLE: subject, MESSAGE: message }, // fallback if a version somehow lacks params
          messageVersions: chunk,
        }),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        const text = await res.text();
        console.error('Brevo batch error:', res.status, text);
        errors.push(`Batch ${i / CHUNK_SIZE + 1} failed (${res.status}).`);
      }
    } catch (err) {
      console.error('Brevo batch request failed:', err);
      errors.push(`Batch ${i / CHUNK_SIZE + 1} failed to send.`);
    }
  }

  // Log the broadcast for the admin's own record-keeping (visible in the dashboard's history list).
  try {
    await db.collection('broadcasts').add({
      target,
      skill: target === 'skill' ? skill : null,
      singleEmail: target === 'single' ? singleEmail : null,
      subject,
      message,
      recipientCount: recipients.length,
      sentCount: sent,
      sentBy: access.role === 'master' ? 'Main admin' : (access.email || 'Unknown'),
      createdAt: fbAdmin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Broadcast log write failed:', err);
    // Don't fail the request over this — the emails already went out.
  }

  return {
    statusCode: sent > 0 ? 200 : 500,
    body: JSON.stringify({
      success: sent > 0,
      recipientCount: recipients.length,
      sentCount: sent,
      errors,
    }),
  };
};
