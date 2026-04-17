// api/auth.js — Validación de token Azure AD + SWA built-in auth
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const tenantId = process.env.AZURE_TENANT_ID;
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 86400000
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

async function validateToken(req) {
  // Método 1: Azure SWA built-in auth — header X-MS-CLIENT-PRINCIPAL
  const swaPrincipal = req.headers['x-ms-client-principal'];
  if (swaPrincipal) {
    try {
      const decoded = JSON.parse(Buffer.from(swaPrincipal, 'base64').toString('utf8'));
      if (decoded && decoded.userDetails) {
        return {
          valid: true,
          user: {
            azureId: decoded.userId || decoded.userDetails,
            email:   decoded.userDetails,
            name:    decoded.userDetails,
            roles:   decoded.userRoles || []
          }
        };
      }
    } catch(e) { console.log('SWA principal error:', e.message); }
  }

  // Método 2: Bearer JWT token
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
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
        if (err) resolve({ valid: false, error: err.message });
        else resolve({
          valid: true,
          user: {
            azureId: decoded.oid || decoded.sub,
            email:   decoded.preferred_username || decoded.upn || decoded.email,
            name:    decoded.name,
            roles:   decoded.roles || []
          }
        });
      });
    });
  }

  return { valid: false, error: 'Token no provisto' };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL',
    'Content-Type': 'application/json'
  };
}

module.exports = { validateToken, corsHeaders };
