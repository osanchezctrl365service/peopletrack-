// api/db.js — Conexión a Azure SQL
const sql = require('mssql');

let pool = null;

const config = {
  server:   process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user:     process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: true,          // Requerido para Azure SQL
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

async function query(sqlText, params = {}) {
  const p = await getPool();
  const req = p.request();
  for (const [key, val] of Object.entries(params)) {
    req.input(key, val);
  }
  return req.query(sqlText);
}

async function execute(spName, params = {}) {
  const p = await getPool();
  const req = p.request();
  for (const [key, val] of Object.entries(params)) {
    req.input(key, val);
  }
  return req.execute(spName);
}

module.exports = { query, execute, sql };
