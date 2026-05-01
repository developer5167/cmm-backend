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

  // Login User 1
  let sendOtp = await axios.post('http://localhost:5050/api/v1/auth/send-otp', { phone_number: '8888888888' });
  let otpRes = await client.query("SELECT otp_code FROM otp_sessions WHERE phone_number = '+918888888888' ORDER BY created_at DESC LIMIT 1");
  let verify = await axios.post('http://localhost:5050/api/v1/auth/verify-otp', { phone_number: '8888888888', otp: otpRes.rows[0].otp_code });
  const token1 = verify.data.data.access_token;
  const user1Id = verify.data.data.user.id;

  // Login User 2
  sendOtp = await axios.post('http://localhost:5050/api/v1/auth/send-otp', { phone_number: '9999999999' });
  otpRes = await client.query("SELECT otp_code FROM otp_sessions WHERE phone_number = '+919999999999' ORDER BY created_at DESC LIMIT 1");
  verify = await axios.post('http://localhost:5050/api/v1/auth/verify-otp', { phone_number: '9999999999', otp: otpRes.rows[0].otp_code });
  const token2 = verify.data.data.access_token;
  const user2Id = verify.data.data.user.id;

  console.log("Logged in both users");

  // User 1 sends interest to User 2
  const interestReq = await axios.post('http://localhost:5050/api/v1/interests',
    { receiver_id: user2Id },
    { headers: { Authorization: `Bearer ${token1}` } }
  );
  console.log("Interest Sent:", interestReq.data.message);
  const interestId = interestReq.data.data.interest_id;

  // User 2 lists received
  const receivedList = await axios.get('http://localhost:5050/api/v1/interests/list?type=received',
    { headers: { Authorization: `Bearer ${token2}` } }
  );
  console.log("User 2 Received Interests:", receivedList.data.data.length);

  // User 2 accepts
  const acceptReq = await axios.post(`http://localhost:5050/api/v1/interests/${interestId}/accept`,
    {},
    { headers: { Authorization: `Bearer ${token2}` } }
  );
  console.log("Interest Accepted:", acceptReq.data.message);

  // User 1 gets connected list (should return conversation ID)
  const connectedList = await axios.get('http://localhost:5050/api/v1/interests/list?type=connected',
    { headers: { Authorization: `Bearer ${token1}` } }
  );
  console.log("User 1 Connected List:", connectedList.data.data.length);
  const conversationId = connectedList.data.data[0].conversation_id;

  // Discover feed - check if exclude interacted works
  const feed = await axios.get('http://localhost:5050/api/v1/discover/feed', { headers: { Authorization: `Bearer ${token1}` } });
  console.log("Feed size after interaction:", feed.data.data.profiles.length);

  // Chat API - Send Message
  const msgReq = await axios.post(`http://localhost:5050/api/v1/chat/${conversationId}/messages`,
    { content: 'Hello there!' },
    { headers: { Authorization: `Bearer ${token1}` } }
  );
  console.log("Message Sent:", msgReq.data.message);

  // Chat API - Get Message history (User 2)
  const hist = await axios.get(`http://localhost:5050/api/v1/chat/${conversationId}/messages`,
    { headers: { Authorization: `Bearer ${token2}` } }
  );
  console.log("Message History from User 2:", hist.data.data.length, "messages.", "First msg:", hist.data.data[0].content);

  await client.end();
}

run().catch(console.error);
