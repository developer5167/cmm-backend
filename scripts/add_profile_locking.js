const { query, pool } = require('../src/db');

async function migrate() {
  try {
    console.log('Adding locking columns to user_profiles...');
    await query(`
      ALTER TABLE user_profiles 
      ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES admin_users(id),
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
    `);
    
    console.log('✅ Migration complete');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
