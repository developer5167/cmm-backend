const { query } = require('./src/db');

async function checkInterests() {
  try {
    const res = await query('SELECT * FROM interests ORDER BY sent_at DESC LIMIT 5');
    console.log('Latest Interests:', JSON.stringify(res.rows, null, 2));
    
    const countRes = await query('SELECT status, count(*) FROM interests GROUP BY status');
    console.log('Interest Counts:', countRes.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkInterests();
