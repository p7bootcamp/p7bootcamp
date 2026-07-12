const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// Reuse the same Firebase app across warm invocations instead of re-initializing every time
function getAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

// If your Firestore database is Enterprise edition (or any named database other than
// the Standard-edition default), set FIRESTORE_DATABASE_ID in Netlify to match its exact ID.
// Leave unset if you're on a Standard edition "(default)" database.
function getDb(fbAdmin) {
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  return getFirestore(fbAdmin.app(), databaseId);
}

// Maps each of the four selectable skills to its own Brevo template ID (set these in Netlify env vars)
const TEMPLATE_MAP = {
  'Smartphone Photography & Videography': process.env.BREVO_TEMPLATE_PHOTOGRAPHY,
  'AI Animation & Video Editing': process.env.BREVO_TEMPLATE_AI_ANIMATION,
  'Graphic Design': process.env.BREVO_TEMPLATE_GRAPHIC_DESIGN,
  'Web Development': process.env.BREVO_TEMPLATE_WEB_DEV,
};

const GMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

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

  const fullName = (data.fullName || '').trim();
  const email = (data.email || '').trim().toLowerCase();
  const zone = (data.zone || '').trim();
  const age = Number(data.age);
  const skill = (data.skill || '').trim();
  const expectation = (data.expectation || '').trim();

  // Server-side validation — never trust the client alone
  if (!fullName || fullName.length < 3) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid full name.' }) };
  }
  if (!GMAIL_PATTERN.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid Gmail address.' }) };
  }
  if (!zone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter your zone.' }) };
  }
  if (!age || age < 10 || age > 25) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Age must be between 10 and 25.' }) };
  }
  if (!TEMPLATE_MAP[skill]) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please select a valid skill.' }) };
  }
  if (expectation.length > 280) {
    return { statusCode: 400, body: JSON.stringify({ error: 'That message is too long.' }) };
  }

  const fbAdmin = getAdmin();
  const db = getDb(fbAdmin);

  // Hard duplicate check — this is the real gate; the client-side check-email call
  // is just there to warn people earlier, but this is what actually prevents it.
  try {
    const existing = await db.collection('registrations').where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This email has already registered for the bootcamp.' }) };
    }
  } catch (err) {
    console.error('Duplicate check failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify your registration. Please try again.' }) };
  }

  // Save the registration first — if the email fails afterwards, the registrant still isn't lost
  let docRef;
  try {
    docRef = await db.collection('registrations').add({
      fullName,
      email,
      zone,
      age,
      skill,
      expectation,
      createdAt: fbAdmin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Firestore write failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save your registration. Please try again.' }) };
  }

  // Send the confirmation email — this failing should not undo the registration above
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
        to: [{ email, name: fullName }],
        templateId: Number(TEMPLATE_MAP[skill]),
        params: {
          FULLNAME: fullName,
          FIRSTNAME: fullName.split(' ')[0],
          SKILL: skill,
          ZONE: zone,
        },
      }),
    });
    emailSent = res.ok;
    if (!res.ok) console.error('Brevo error:', res.status, await res.text());
  } catch (err) {
    console.error('Brevo request failed:', err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, id: docRef.id, emailSent }),
  };
};
