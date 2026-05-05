/**
 * Run once: creates the performance indexes from 006_performance_indexes.sql
 * Usage:  node scripts/run_indexes.js
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

(async () => {
  const sqlPath = path.join(__dirname, '../src/db/migrations/006_performance_indexes.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');

  // Split on semicolons, strip comment lines, skip blanks
  const statements = sql
    .split(';')
    .map(s =>
      s
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(s => s.length > 0);

  const client = await pool.connect();
  try {
    console.log(`Running ${statements.length} index statements…\n`);
    for (const stmt of statements) {
      const label = stmt.slice(0, 60).replace(/\s+/g, ' ');
      process.stdout.write(`  • ${label}…`);
      await client.query(stmt);
      console.log(' ✓');
    }
    console.log('\n✅  All indexes created successfully.');
  } catch (err) {
    console.error('\n❌  Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
