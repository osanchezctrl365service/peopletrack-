// api/auth.js — Validación de token Azure AD
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const tenantId = process.env.AZURE_TENANT_ID;

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 86400000 // 24 horas
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

async function validateToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Token no provisto' };
  }

  const token = authHeader.split(' ')[1];

  return new Promise((resolve) => {
    jwt.verify(token, getKey, {
      audience: process.env.AZURE_CLIENT_ID,
      issuer: [
        `https://login.microsoftonline.com/${tenantId}/v2.0`,
        `https://sts.windows.net/${tenantId}/`
      ],
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) {
        resolve({ valid: false, error: err.message });
      } else {
        resolve({
          valid: true,
          user: {
            azureId: decoded.oid || decoded.sub,
            email:   decoded.preferred_username || decoded.upn || decoded.email,
            name:    decoded.name,
            roles:   decoded.roles || []
          }
        });
      }
    });
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

module.exports = { validateToken, corsHeaders };
