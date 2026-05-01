/**
 * Storage Service – GraceMatch
 * Dev mode  : saves files locally in uploads/
 * Prod mode : uploads to AWS S3
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ─── Local Storage (development) ────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

const ensureUploadDir = (subDir = '') => {
  const dir = path.join(UPLOAD_DIR, subDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const saveLocally = async (file, folder = 'misc') => {
  const dir = ensureUploadDir(folder);
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${uuidv4()}${ext}`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, file.buffer);

  const s3Key = `${folder}/${filename}`;
  const url = `http://localhost:${process.env.PORT || 5050}/uploads/${s3Key}`;
  return { url, s3Key };
};

// ─── S3 Storage (production) ─────────────────────────────────
let s3Client = null;

const getS3Client = () => {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
};

const uploadToS3 = async (file, folder = 'misc') => {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${uuidv4()}${ext}`;
  
  const envPrefix = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const s3Key = `${envPrefix}/${folder}/${filename}`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  const url = `${process.env.S3_BASE_URL}/${s3Key}`;
  return { url, s3Key };
};

/**
 * Upload a file (auto-selects local vs S3 based on env)
 * @param {Object} file - multer file object (with buffer)
 * @param {string} folder - destination folder name
 * @returns {{ url: string, s3Key: string }}
 */
const uploadFile = async (file, folder = 'misc') => {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    return saveLocally(file, folder);
  }
  return uploadToS3(file, folder);
};

/**
 * Delete a file by S3 key
 */
const deleteFile = async (s3Key) => {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    const localPath = path.join(UPLOAD_DIR, s3Key.replace(/^\//, ''));
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    return;
  }

  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
    })
  );
};

module.exports = { uploadFile, deleteFile };
