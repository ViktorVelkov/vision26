// db.js
const { Pool } = require('pg');

const pool = new Pool({
  user: 'viktorvelkov',
  host: 'localhost',
  database: 'viktorvelkov',
  password: 'Errpass1',
  port: 5432
});

module.exports = pool;