#!/usr/bin/env node
/**
 * GraceMatch – Database Migration Runner
 * Usage: node scripts/migrate.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'grace_match',
  user: process.env.DB_USER || 'kcs',
  password: process.env.DB_PASSWORD || '',
});

const run = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting GraceMatch database migration...\n');

    const migrationsDir = path.join(__dirname, '../src/db/migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      console.log(`⚡ Running: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`   ✅ Done: ${file}\n`);
    }

    console.log('🎉 All migrations completed successfully!');
    console.log('\n📊 Tables created:');

    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    tables.rows.forEach(r => console.log(`   • ${r.tablename}`));
    console.log(`\nTotal: ${tables.rows.length} tables\n`);

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    if (err.hint) console.error('   Hint:', err.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
