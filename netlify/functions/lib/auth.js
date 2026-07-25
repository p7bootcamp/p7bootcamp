const { getFirestore } = require('firebase-admin/firestore');

function getDb(fbAdmin) {
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  return getFirestore(fbAdmin.app(), databaseId);
}

// Every protected admin function calls this with the request's headers.
// Two ways in:
//   1. The master password (ADMIN_DASHBOARD_PASSWORD) — that's you, always works.
//   2. An invite token that's been accepted and not since removed — that's an invited admin.
// Returns { ok: true, role: 'master' | 'invited', email? } or { ok: false, statusCode, error }.
async function verifyAdminAccess(event, fbAdmin) {
  const key = event.headers['x-admin-key'] || event.headers['x-admin-password'] || '';

  if (!key) {
    return { ok: false, statusCode: 401, error: 'Unauthorized' };
  }

  if (process.env.ADMIN_DASHBOARD_PASSWORD && key === process.env.ADMIN_DASHBOARD_PASSWORD) {
    return { ok: true, role: 'master' };
  }

  const db = getDb(fbAdmin);

  try {
    const doc = await db.collection('admin_invites').doc(key).get();
    if (!doc.exists) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }
    const invite = doc.data();
    if (invite.status === 'removed') {
      return { ok: false, statusCode: 403, error: 'removed' };
    }
    if (invite.status !== 'accepted') {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }
    return { ok: true, role: 'invited', email: invite.email };
  } catch (err) {
    console.error('Admin token check failed:', err);
    return { ok: false, statusCode: 500, error: 'Could not verify access.' };
  }
}

module.exports = { verifyAdminAccess, getDb };
