const { query, pool } = require('../src/db');

async function migrate() {
  try {
    console.log('Adding review_status to user_profiles...');
    await query(`
      ALTER TABLE user_profiles 
      ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending';
    `);
    
    // Also update existing users to approved so they don't disappear
    await query(`
      UPDATE user_profiles SET review_status = 'approved' WHERE review_status IS NULL;
    `);
    
    console.log('✅ Migration complete');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
