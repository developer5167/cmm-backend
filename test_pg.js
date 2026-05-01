const { Client } = require('pg');
async function test() {
  const client = new Client({ connectionString: 'postgres://grace_match_user:super_secret_password_123@localhost:5432/grace_match' });
  await client.connect();
  const res = await client.query('SELECT *, preferred_denominations::text[] as preferred_denominations_arr FROM user_partner_preferences LIMIT 1');
  console.log(res.rows[0]);
  await client.end();
}
test().catch(console.error);
