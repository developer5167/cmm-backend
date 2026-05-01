const { query } = require('./src/db');

async function updateSchema() {
  try {
    await query(`
      ALTER TABLE user_family 
      ADD COLUMN IF NOT EXISTS sibling_details JSONB DEFAULT '[]'
    `);
    console.log('✅ Added sibling_details column to user_family table.');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

updateSchema();
