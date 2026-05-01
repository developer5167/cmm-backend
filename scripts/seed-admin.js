const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function seed() {
  try {
    await client.connect();
    const email = 'admin@gracematch.com';
    const check = await client.query('SELECT id FROM admin_users WHERE email = $1', [email]);
    
    if (check.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(
        'INSERT INTO admin_users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
        [email, hash, 'Super Admin', 'super_admin']
      );
      console.log('✅ Default super admin created: admin@gracematch.com / admin123');
    } else {
      console.log('ℹ️ Admin already exists');
    }
  } catch (err) {
    console.error('❌ Seeding failed:', err);
  } finally {
    await client.end();
  }
}

seed();
