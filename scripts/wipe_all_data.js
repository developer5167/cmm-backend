const { query } = require('../src/db');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '../.env' });

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function wipeS3() {
  console.log('--- Wiping S3 Bucket ---');
  const bucketName = process.env.S3_BUCKET_NAME;
  
  try {
    const listCommand = new ListObjectsV2Command({ Bucket: bucketName });
    const listResponse = await s3Client.send(listCommand);

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: listResponse.Contents.map((content) => ({ Key: content.Key })),
        },
      };
      const deleteCommand = new DeleteObjectsCommand(deleteParams);
      await s3Client.send(deleteCommand);
      console.log(`✅ Deleted ${listResponse.Contents.length} objects from S3.`);
    } else {
      console.log('ℹ️ S3 bucket is already empty.');
    }
  } catch (err) {
    console.error('❌ Error wiping S3:', err.message);
  }
}

async function wipeDatabase() {
  console.log('--- Wiping Database ---');
  const tables = [
    'otp_sessions',
    'interests',
    'conversations',
    'messages',
    'notifications',
    'profile_views',
    'profile_revisions',
    'user_photos',
    'user_hobbies',
    'user_family',
    'user_partner_preferences',
    'user_profiles',
    'users' // User is last due to FKs
  ];

  try {
    // Truncate all tables and reset identities
    const truncateQuery = `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE;`;
    await query(truncateQuery);
    console.log('✅ All database tables truncated and identities reset.');
    
    // Optional: Keep admin users if they are in a different table or identified by a flag
    // If you want to keep admin users, we would need a DELETE WHERE instead of TRUNCATE
    // But usually a "fresh registration" means starting from absolute zero.
    
  } catch (err) {
    console.error('❌ Error wiping Database:', err.message);
  }
}

async function run() {
  console.log('⚠️  DANGER: Starting full data wipe in 3 seconds...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await wipeS3();
  await wipeDatabase();
  
  console.log('\n✨ CLEANUP COMPLETE. You can now do a fresh registration.');
  process.exit(0);
}

run();
