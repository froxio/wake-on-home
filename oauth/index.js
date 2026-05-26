/**
 * Minimal OAuth2 server for Google Smart Home account linking.
 *
 * Google requires a real OAuth2 flow to link a Smart Home action to a Google account.
 * Since this is a single-user personal project we don't need real auth — this server
 * just completes the handshake with hardcoded values so Google Home trusts the action.
 *
 * Endpoints:
 *   GET  /auth   — Google redirects the user here to "log in". We immediately redirect
 *                  back with an auth code (no login UI needed for personal use).
 *   POST /token  — Google exchanges the auth code for an access token. We return a
 *                  hardcoded token that the wake-on-home Lambda doesn't validate.
 *
 * Required env vars:
 *   OAUTH_CLIENT_ID     — must match what you entered in the Actions console
 *   OAUTH_CLIENT_SECRET — must match what you entered in the Actions console
 *   OAUTH_TOKEN         — any random string, used as the permanent access token
 */

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.requestContext?.http?.path || event.path;
  console.log(JSON.stringify({ method, path, qs: event.queryStringParameters, body: event.body }));

  if (method === 'GET' && path === '/auth') {
    return handleAuth(event);
  }

  if (method === 'POST' && path === '/token') {
    return handleToken(event);
  }

  return { statusCode: 404, body: 'Not found' };
};

function handleAuth(event) {
  const params = event.queryStringParameters || {};
  const redirectUri = params.redirect_uri;
  const state = params.state;
  const clientId = params.client_id;

  if (clientId !== process.env.OAUTH_CLIENT_ID) {
    console.log(`auth: client_id mismatch — got "${clientId}", expected "${process.env.OAUTH_CLIENT_ID}"`);
    return { statusCode: 401, body: 'Invalid client_id' };
  }

  // Skip login UI — immediately redirect back with a hardcoded auth code
  const code = 'wake-on-home-auth-code';
  const location = `${redirectUri}?code=${code}&state=${state}`;
  return {
    statusCode: 302,
    headers: { Location: location },
    body: '',
  };
}

function handleToken(event) {
  const body = parseBody(event.body, event.headers?.['content-type'], event.isBase64Encoded);
  const { grant_type, code, client_id, client_secret, refresh_token } = body;

  if (client_id !== process.env.OAUTH_CLIENT_ID || client_secret !== process.env.OAUTH_CLIENT_SECRET) {
    console.log(`token: credential mismatch — client_id match: ${client_id === process.env.OAUTH_CLIENT_ID}, secret match: ${client_secret === process.env.OAUTH_CLIENT_SECRET}`);
    return { statusCode: 401, body: JSON.stringify({ error: 'invalid_client' }) };
  }

  const isAuthCode = grant_type === 'authorization_code' && code === 'wake-on-home-auth-code';
  const isRefresh = grant_type === 'refresh_token' && refresh_token === process.env.OAUTH_TOKEN;

  if (!isAuthCode && !isRefresh) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid_grant' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: process.env.OAUTH_TOKEN,
      refresh_token: process.env.OAUTH_TOKEN,
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  };
}

function parseBody(raw, contentType, isBase64Encoded) {
  if (!raw) return {};
  const decoded = isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (contentType?.includes('application/json')) return JSON.parse(decoded);
  return Object.fromEntries(new URLSearchParams(decoded));
}
