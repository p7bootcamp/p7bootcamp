// Duplicate emails are now allowed to register again — every submission is
// treated as a brand new registration. This endpoint no longer checks
// Firestore at all; it always reports not-registered so the frontend's
// "already registered" warning never fires. Kept as a no-op so the
// frontend's existing fetch call doesn't need to change.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ registered: false }) };
};
