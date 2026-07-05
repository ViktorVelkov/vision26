// db.js
const { Pool } = require('pg');
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        user: 'postgres',
        host: 'localhost',
        database: 'viktorvelkov',
        password: 'Errpass1',
        port: 5432
      }
);



module.exports = pool;