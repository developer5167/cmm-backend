const axios = require('axios');
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER
});

async function run() {
  await client.connect();

  // Create another user directly in DB
  const user2 = await client.query(`
    INSERT INTO users (phone_number, country_code, is_phone_verified, is_onboarding_complete, onboarding_step)
    VALUES ('9999999999', '+91', true, true, 10)
    RETURNING id
  `);
  
  const user2Id = user2.rows[0].id;
  await client.query(`
    INSERT INTO user_profiles (user_id, gender, looking_for, first_name, last_name, date_of_birth, location_city, denomination, profile_visibility, profile_completion_score)
    VALUES ($1, 'female', 'male', 'Mary', 'Joseph', '1997-05-15', 'Kochi', 'csi', 'everyone', 80)
  `, [user2Id]);

  console.log("Seeded user Mary");

  // Get OTP and token for user 1
  await axios.post('http://localhost:5050/api/v1/auth/send-otp', { phone_number: '8888888888' });
  const otpRes = await client.query("SELECT otp_code FROM otp_sessions WHERE phone_number = '+918888888888' ORDER BY created_at DESC LIMIT 1");
  const otp = otpRes.rows[0].otp_code;
  
  const verify = await axios.post('http://localhost:5050/api/v1/auth/verify-otp', { phone_number: '8888888888', otp });
  const token = verify.data.data.access_token;

  console.log("Login successful");
  
  // Test get profile
  const profile = await axios.get('http://localhost:5050/api/v1/profile/me', { headers: { Authorization: `Bearer ${token}` } });
  console.log("My Profile City:", profile.data.data.profile.location_city);

  // Update profile
  const updated = await axios.put('http://localhost:5050/api/v1/profile/me', 
    { location_city: 'Trivandrum' }, 
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log("Updated City:", updated.data.data.location_city);

  // Discover feed
  const feed = await axios.get('http://localhost:5050/api/v1/discover/feed', { headers: { Authorization: `Bearer ${token}` } });
  console.log("Discover Results:", feed.data.data.profiles.length, feed.data.data.profiles.map(p => p.first_name + ' (Score: ' + p.compatibility_score +')'));
  
  await client.end();
}

run().catch(console.error);

