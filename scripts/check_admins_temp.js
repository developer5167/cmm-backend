const { query, pool } = require('../src/db');
const bcrypt = require('bcryptjs');

async function checkAdmins() {
  try {
    const result = await query('SELECT id, email, name, role, is_active FROM admin_users');
    console.log('Current Admins:', result.rows);
    
    if (result.rows.length === 0) {
      console.log('No admins found. Seeding a default super admin...');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('admin123', salt);
      await query(
        'INSERT INTO admin_users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
        ['admin@gracematch.com', hash, 'Main Admin', 'super_admin']
      );
      console.log('Default super admin created: admin@gracematch.com / admin123');
    }
  } catch (err) {
    console.error('Error checking/seeding admins:', err.message);
  } finally {
    await pool.end();
  }
}

checkAdmins();
