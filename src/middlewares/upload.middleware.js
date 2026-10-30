const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadBaseDir = path.join(__dirname, '..', '..', 'uploads');
const receiptDir = path.join(uploadBaseDir, 'receipts');
const propertyDir = path.join(uploadBaseDir, 'properties');

[uploadBaseDir, receiptDir, propertyDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.gif', '.heic', '.heif'];
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'image/pjpeg',
  'image/heic',
  'image/heif',
  'image/gif',
  'application/pdf',
];

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'receipt' || req.baseUrl.includes('upload')) {
      cb(null, receiptDir);
    } else {
      cb(null, propertyDir);
    }
  },
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext || ext === '' || ext === '.bin') {
      if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else if (file.mimetype === 'application/pdf') ext = '.pdf';
      else if (file.mimetype === 'image/gif') ext = '.gif';
      else ext = '.jpg';
    }
    const rawBase = path.basename(file.originalname || 'receipt', ext);
    const cleanName = (rawBase.replace(/[^a-zA-Z0-9_-]/g, '_') || 'receipt').substring(0, 50);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    cb(null, `${cleanName}-${uniqueSuffix}${ext}`);
  },
});

// File filter (images and PDFs)
const fileFilter = (req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();

  const isMimeOk = ALLOWED_MIMES.includes(mime) || mime.startsWith('image/');
  const isExtOk = ALLOWED_EXTS.includes(ext);

  // Accept if valid image/pdf MIME, or valid extension, or generic stream with image intent
  if (isMimeOk || isExtOk || mime === 'application/octet-stream' || mime === 'binary/octet-stream' || !mime) {
    cb(null, true);
  } else {
    const err = new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed.');
    err.statusCode = 400;
    cb(err, false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB limit
  },
  fileFilter,
});

module.exports = upload;
