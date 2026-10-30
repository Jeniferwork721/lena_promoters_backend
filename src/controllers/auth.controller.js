const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { sendSmsOtp } = require('../services/twoFactor.service');
const { sendEmailOtp } = require('../services/email.service');

const JWT_SECRET = process.env.JWT_SECRET || 'lena_promoters_jwt_secret_key_2026_super_secure';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'lena_promoters_jwt_refresh_secret_key_2026_secure';

/**
 * Helper to issue access token (1h) and long-lived refresh token (30d staff / 90d customer),
 * and record refresh token in the database.
 */
async function issueTokens(user, userType = 'STAFF') {
  const isStaff = userType === 'STAFF';
  const accessPayload = isStaff
    ? {
        id: user.id,
        employeeId: user.employee_id,
        fullName: user.full_name,
        role: user.role,
        branch: user.branch_location,
        userType: 'STAFF',
      }
    : {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone_number,
        role: 'CUSTOMER',
        userType: 'CUSTOMER',
      };

  const token = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: '1h' });
  const refreshDays = isStaff ? 30 : 90;
  const refreshToken = jwt.sign(
    {
      id: user.id,
      userType,
      salt: Math.random().toString(36).substring(2, 12),
    },
    JWT_REFRESH_SECRET,
    { expiresIn: `${refreshDays}d` }
  );

  const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_type, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
    [userType, user.id, refreshToken, expiresAt]
  );

  return { token, refreshToken };
}

/**
 * Helper to generate sequential Staff ID (e.g. LP-EMP-105)
 */
async function generateNextStaffId() {
  const [rows] = await pool.query(
    "SELECT employee_id FROM staff_users WHERE employee_id LIKE 'LP-EMP-%'"
  );
  const used = new Set(
    rows
      .map(r => parseInt(r.employee_id.replace(/^LP-EMP-/i, ''), 10))
      .filter(n => !isNaN(n))
  );

  let candidate = 101;
  while (used.has(candidate)) {
    candidate++;
  }
  return `LP-EMP-${candidate}`;
}

/**
 * 1. Staff Login using Password (Email or Phone)
 */
async function loginWithPassword(req, res, next) {
  try {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email/phone number and password.',
      });
    }

    const cleanInput = emailOrPhone.trim();

    // Query staff user by email or phone
    const [users] = await pool.query(
      'SELECT * FROM staff_users WHERE (email = ? OR phone_number = ?) AND is_active = 1 LIMIT 1',
      [cleanInput, cleanInput]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'No registered staff member found with these credentials.',
      });
    }

    const staff = users[0];
    const isMatch = await bcrypt.compare(password, staff.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password. Please verify and try again.',
      });
    }

    // Generate JWT access & refresh tokens
    const { token, refreshToken } = await issueTokens(staff, 'STAFF');

    return res.status(200).json({
      success: true,
      message: 'Staff authentication successful',
      token,
      refreshToken,
      staff: {
        id: staff.id,
        employeeId: staff.employee_id,
        fullName: staff.full_name,
        email: staff.email,
        phone: staff.phone_number,
        branch: staff.branch_location,
        role: staff.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Send OTP (to staff phone or email)
 */
async function sendOtp(req, res, next) {
  try {
    const { emailOrPhone, purpose = 'LOGIN' } = req.body;

    if (!emailOrPhone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide phone number or email address to receive OTP.',
      });
    }

    const cleanInput = emailOrPhone.trim();

    // If registering, check for existing user so they don't register repeatedly
    if (purpose === 'STAFF_REGISTER') {
      const [existingStaff] = await pool.query(
        'SELECT id FROM staff_users WHERE (phone_number = ? AND phone_number != "") OR (email = ? AND email != "") LIMIT 1',
        [cleanInput, cleanInput]
      );
      if (existingStaff.length > 0) {
        const isEmail = cleanInput.includes('@');
        return res.status(409).json({
          success: false,
          userExists: true,
          message: isEmail
            ? 'An employee account with this email address already exists. Please login instead.'
            : 'An employee account with this mobile number already exists. Please login instead.',
        });
      }
    }

    // For test/dev purposes, generate 4-digit OTP (e.g. 7842 or random)
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Invalidate old un-used OTPs for this user
    await pool.query(
      'UPDATE otp_codes SET is_used = 1 WHERE phone_or_email = ? AND is_used = 0',
      [cleanInput]
    );

    // Save new OTP
    await pool.query(
      'INSERT INTO otp_codes (phone_or_email, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
      [cleanInput, otp, purpose, expiresAt]
    );

    console.log(`🔑 [OTP Dispatch] Code for ${cleanInput} is: ${otp}`);

    const isEmail = cleanInput.includes('@');
    let emailResult = { isLiveEmail: false };
    let smsResult = { isLiveSms: false };

    if (isEmail) {
      emailResult = await sendEmailOtp(cleanInput, otp, purpose);
    } else {
      smsResult = await sendSmsOtp(cleanInput, otp);
    }

    const message = isEmail
      ? (emailResult.isLiveEmail
          ? `Verification code emailed to ${cleanInput}. Please check your inbox.`
          : `Verification code generated for ${cleanInput}.`)
      : (smsResult.isLiveSms
          ? `Live SMS OTP dispatched via 2Factor to ${cleanInput}.`
          : `SMS OTP dispatched to ${cleanInput}.`);

    return res.status(200).json({
      success: true,
      message,
      expiresInSeconds: 600,
      isEmail,
      isLiveSms: smsResult.isLiveSms || false,
      isLiveEmail: emailResult.isLiveEmail || false,
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Verify OTP & Login
 */
async function loginWithOtp(req, res, next) {
  try {
    const { emailOrPhone, otp } = req.body;

    if (!emailOrPhone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email/phone and OTP.',
      });
    }

    const cleanInput = emailOrPhone.trim();
    const cleanOtp = otp.trim();

    // Validate OTP in database (or allow default master testing OTP '7842')
    const [records] = await pool.query(
      `SELECT * FROM otp_codes 
       WHERE phone_or_email = ? AND otp = ? AND is_used = 0 AND expires_at > NOW() 
       ORDER BY created_at DESC LIMIT 1`,
      [cleanInput, cleanOtp]
    );

    const isMasterOtp = cleanOtp === '7842';

    if (records.length === 0 && !isMasterOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new code.',
      });
    }

    // Mark OTP as used if found
    if (records.length > 0) {
      await pool.query('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [records[0].id]);
    }

    // Find or create staff session
    let [users] = await pool.query(
      'SELECT * FROM staff_users WHERE (email = ? OR phone_number = ?) LIMIT 1',
      [cleanInput, cleanInput]
    );

    let staff;
    if (users.length > 0) {
      staff = users[0];
    } else {
      // Auto-provision verified staff profile with sequential employee ID
      const isEmail = cleanInput.includes('@');
      const employeeId = await generateNextStaffId();
      const defaultHash = await bcrypt.hash('LenaStaff@2026', 10);

      const [insertResult] = await pool.query(
        `INSERT INTO staff_users (employee_id, full_name, email, phone_number, password_hash, branch_location, role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          employeeId,
          'Lena Staff Member',
          isEmail ? cleanInput : `staff.${Date.now()}@lenapromoters.com`,
          isEmail ? `9444${Math.floor(100000 + Math.random() * 900000)}` : cleanInput,
          defaultHash,
          'Karaikudi – Head Office',
          'STAFF',
        ]
      );

      const [newStaff] = await pool.query('SELECT * FROM staff_users WHERE id = ?', [insertResult.insertId]);
      staff = newStaff[0];
    }

    const { token, refreshToken } = await issueTokens(staff, 'STAFF');

    return res.status(200).json({
      success: true,
      message: 'OTP verification successful',
      token,
      refreshToken,
      staff: {
        id: staff.id,
        employeeId: staff.employee_id,
        fullName: staff.full_name,
        email: staff.email,
        phone: staff.phone_number,
        branch: staff.branch_location,
        role: staff.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Register Password with OTP
 */
async function registerPasswordWithOtp(req, res, next) {
  try {
    const {
      name,
      fullName: reqFullName,
      emailOrPhone,
      email,
      phone,
      phoneNumber,
      otp,
      newPassword,
      branch,
      branchLocation,
    } = req.body;
    const finalName = (reqFullName || name || '').trim() || 'Authorized Lena Staff';
    const selectedBranch = (branchLocation || branch || '').trim() || 'Karaikudi – Head Office';

    const cleanInput = (emailOrPhone || phone || phoneNumber || email || '').trim();
    const cleanOtp = (otp || '').trim();

    if (!cleanInput || !cleanOtp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Staff details, verification code, and password are required.',
      });
    }

    const inputPhone = (phone || phoneNumber || (!cleanInput.includes('@') ? cleanInput : '')).replace(/[^0-9]/g, '');
    const inputEmail = (email || (cleanInput.includes('@') ? cleanInput : '')).trim();

    // Verify OTP against whichever channel was verified (cleanInput, inputPhone, inputEmail, or master '7842')
    const [records] = await pool.query(
      `SELECT * FROM otp_codes 
       WHERE (phone_or_email = ? OR phone_or_email = ? OR phone_or_email = ?) AND otp = ? AND is_used = 0 AND expires_at > NOW() 
       ORDER BY created_at DESC LIMIT 1`,
      [cleanInput, inputPhone || 'none', inputEmail || 'none', cleanOtp]
    );

    const isMasterOtp = cleanOtp === '7842';

    if (records.length === 0 && !isMasterOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please request a new code.',
      });
    }

    if (records.length > 0) {
      await pool.query('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [records[0].id]);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const fullName = finalName;

    const staffPhone = inputPhone.length >= 10
      ? inputPhone
      : (!cleanInput.includes('@') ? cleanInput : '');
    const staffEmail = inputEmail.includes('@')
      ? inputEmail
      : (cleanInput.includes('@') ? cleanInput : '');

    // Strict uniqueness check: Mobile number cannot be registered repeatedly
    if (staffPhone) {
      const [existingPhone] = await pool.query(
        'SELECT id FROM staff_users WHERE phone_number = ? LIMIT 1',
        [staffPhone]
      );
      if (existingPhone.length > 0) {
        return res.status(409).json({
          success: false,
          userExists: true,
          message: 'An employee account with this mobile number already exists. Please login instead.',
        });
      }
    }

    // Strict uniqueness check: Email address cannot be registered repeatedly
    if (staffEmail) {
      const [existingEmail] = await pool.query(
        'SELECT id FROM staff_users WHERE email = ? LIMIT 1',
        [staffEmail]
      );
      if (existingEmail.length > 0) {
        return res.status(409).json({
          success: false,
          userExists: true,
          message: 'An employee account with this email address already exists. Please login instead.',
        });
      }
    }

    const employeeId = await generateNextStaffId();

    const [inserted] = await pool.query(
      `INSERT INTO staff_users (employee_id, full_name, email, phone_number, password_hash, branch_location, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        fullName,
        staffEmail || `staff.${Date.now()}@lenapromoters.com`,
        staffPhone || `98401${Math.floor(10000 + Math.random() * 90000)}`,
        passwordHash,
        selectedBranch,
        'STAFF',
      ]
    );
    const staffId = inserted.insertId;

    const [staffRows] = await pool.query('SELECT * FROM staff_users WHERE id = ?', [staffId]);
    const staff = staffRows[0];

    const { token, refreshToken } = await issueTokens(staff, 'STAFF');

    return res.status(201).json({
      success: true,
      message: 'Staff password created and authenticated successfully',
      token,
      refreshToken,
      staff: {
        id: staff.id,
        employeeId: staff.employee_id,
        fullName: staff.full_name,
        email: staff.email,
        phone: staff.phone_number,
        branch: staff.branch_location,
        role: staff.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Get Logged In Staff Profile
 */
async function getProfile(req, res, next) {
  try {
    const staffId = req.staff.id;
    const [rows] = await pool.query(
      'SELECT id, employee_id, full_name, email, phone_number, branch_location, role, created_at FROM staff_users WHERE id = ?',
      [staffId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      staff: rows[0],
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. Customer Send OTP (Mobile with 2Factor SMS or Email)
 */
async function sendCustomerOtp(req, res, next) {
  try {
    const { emailOrPhone } = req.body;
    if (!emailOrPhone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile number or email address.',
      });
    }

    const cleanInput = emailOrPhone.trim();
    const cleanDigits = cleanInput.replace(/[^0-9]/g, '');
    const last10 = cleanDigits.slice(-10);

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      'UPDATE otp_codes SET is_used = 1 WHERE (phone_or_email = ? OR phone_or_email = ?) AND is_used = 0',
      [cleanInput, last10 || cleanInput]
    );

    // Save with both raw input and clean 10-digit phone
    await pool.query(
      'INSERT INTO otp_codes (phone_or_email, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
      [cleanInput, otp, 'CUSTOMER_AUTH', expiresAt]
    );
    if (last10 && last10 !== cleanInput) {
      await pool.query(
        'INSERT INTO otp_codes (phone_or_email, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
        [last10, otp, 'CUSTOMER_AUTH', expiresAt]
      );
    }

    console.log(`📱 [Customer OTP] Code for ${cleanInput} (${last10}) is: ${otp}`);

    const isEmail = cleanInput.includes('@');
    let emailResult = { isLiveEmail: false };
    let smsResult = { isLiveSms: false };

    if (isEmail) {
      emailResult = await sendEmailOtp(cleanInput, otp, 'CUSTOMER_AUTH');
    } else {
      smsResult = await sendSmsOtp(cleanInput, otp);
    }

    const message = isEmail
      ? (emailResult.isLiveEmail
          ? `Verification code emailed to ${cleanInput}. Please check your inbox.`
          : `Verification code generated for ${cleanInput}.`)
      : (smsResult.isLiveSms
          ? `Live SMS OTP dispatched via 2Factor to ${cleanInput}.`
          : `OTP code has been sent successfully.`);

    return res.status(200).json({
      success: true,
      message,
      otp, // Provide otp for instant convenience
      expiresInSeconds: 600,
      isEmail,
      isLiveSms: smsResult.isLiveSms || false,
      isLiveEmail: emailResult.isLiveEmail || false,
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. Customer Login using OTP (Mobile or Email)
 */
async function loginCustomerWithOtp(req, res, next) {
  try {
    const { emailOrPhone, otp } = req.body;
    if (!emailOrPhone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile/email and verification OTP.',
      });
    }

    const cleanInput = emailOrPhone.trim();
    const cleanOtp = otp.trim();
    const isEmail = cleanInput.includes('@');
    const cleanDigits = cleanInput.replace(/[^0-9]/g, '');
    const last10 = cleanDigits.slice(-10);

    // Verify OTP against database or master '7842'
    let otpValid = cleanOtp === '7842';
    if (!otpValid) {
      const [records] = await pool.query(
        `SELECT * FROM otp_codes 
         WHERE (phone_or_email = ? OR phone_or_email = ? OR phone_or_email LIKE ?) 
           AND otp = ? AND is_used = 0 AND expires_at > NOW() 
         ORDER BY created_at DESC LIMIT 1`,
        [cleanInput, last10 || cleanInput, `%${last10 || cleanInput}%`, cleanOtp]
      );
      if (records.length > 0) {
        otpValid = true;
        await pool.query('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [records[0].id]);
      }
    }

    if (!otpValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please try again.',
      });
    }

    // Lookup customer in database
    let customer = null;
    if (isEmail) {
      const [rows] = await pool.query(
        'SELECT id, full_name, phone_number, email FROM customers WHERE email = ? AND is_active = 1 LIMIT 1',
        [cleanInput]
      );
      if (rows.length > 0) customer = rows[0];
    } else {
      const [rows] = await pool.query(
        `SELECT id, full_name, phone_number, email FROM customers 
         WHERE (phone_number = ? OR phone_number LIKE ? OR REPLACE(phone_number, '+91', '') LIKE ?) 
           AND is_active = 1 LIMIT 1`,
        [cleanInput, `%${last10}%`, `%${last10}%`]
      );
      if (rows.length > 0) customer = rows[0];
    }

    if (!customer) {
      return res.status(404).json({
        success: false,
        notRegistered: true,
        message: 'No investor account found with these details. Please register your profile.',
      });
    }

    const { token, refreshToken } = await issueTokens(customer, 'CUSTOMER');

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${customer.full_name}!`,
      token,
      refreshToken,
      customer: {
        id: customer.id,
        fullName: customer.full_name,
        phoneNumber: customer.phone_number,
        email: customer.email || '',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 8. Customer Registration (Basic details: Name, Mobile, Email - NO password setup needed!)
 */
async function registerCustomer(req, res, next) {
  try {
    const { fullName, phoneNumber, email, otp } = req.body;

    if (!fullName || !phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Full name, mobile number, and verification OTP are required.',
      });
    }

    const cleanName = fullName.trim();
    const rawPhone = phoneNumber.trim();
    const cleanDigits = rawPhone.replace(/[^0-9]/g, '');
    const last10 = cleanDigits.slice(-10);
    const cleanEmail = email ? email.trim() : null;
    const cleanOtp = otp.trim();

    // Verify OTP against phone or email or master '7842'
    let otpValid = cleanOtp === '7842';
    if (!otpValid) {
      const [records] = await pool.query(
        `SELECT * FROM otp_codes 
         WHERE (phone_or_email = ? OR phone_or_email = ? OR phone_or_email LIKE ? OR (LOWER(phone_or_email) = LOWER(?) AND ? != "")) 
           AND otp = ? AND is_used = 0 AND expires_at > NOW() 
         ORDER BY created_at DESC LIMIT 1`,
        [rawPhone, last10 || rawPhone, `%${last10}%`, cleanEmail || '', cleanEmail || '', cleanOtp]
      );
      if (records.length > 0) {
        otpValid = true;
        await pool.query('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [records[0].id]);
      }
    }

    if (!otpValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please check your verification code.',
      });
    }

    // Strict Uniqueness Check: Mobile number cannot be repeated for customer
    const [existingPhone] = await pool.query(
      `SELECT id FROM customers 
       WHERE (phone_number = ? OR phone_number LIKE ? OR REPLACE(phone_number, '+91', '') LIKE ?) LIMIT 1`,
      [rawPhone, `%${last10}`, `%${last10}`]
    );
    if (existingPhone.length > 0) {
      return res.status(409).json({
        success: false,
        userExists: true,
        message: 'This mobile number is already registered. Please sign in instead.',
      });
    }

    // Strict Uniqueness Check: Email address cannot be repeated for customer
    if (cleanEmail) {
      const [existingEmail] = await pool.query(
        'SELECT id FROM customers WHERE LOWER(email) = LOWER(?) AND email IS NOT NULL AND email != "" LIMIT 1',
        [cleanEmail]
      );
      if (existingEmail.length > 0) {
        return res.status(409).json({
          success: false,
          userExists: true,
          message: 'This email address is already registered to another account. Please sign in or use a different email.',
        });
      }
    }

    // New unique customer insert
    const [insertRes] = await pool.query(
      'INSERT INTO customers (full_name, phone_number, email, is_active) VALUES (?, ?, ?, 1)',
      [cleanName, last10, cleanEmail]
    );
    const customerId = insertRes.insertId;
    console.log(`👤 [Customer Register] Created new unique customer profile (ID: ${customerId}, Phone: ${last10})`);

    const [rows] = await pool.query('SELECT id, full_name, phone_number, email FROM customers WHERE id = ?', [customerId]);
    const customer = rows[0];

    const { token, refreshToken } = await issueTokens(customer, 'CUSTOMER');

    return res.status(201).json({
      success: true,
      message: `Profile registered successfully! Welcome, ${customer.full_name}.`,
      token,
      refreshToken,
      customer: {
        id: customer.id,
        fullName: customer.full_name,
        phoneNumber: customer.phone_number,
        email: customer.email || '',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 9. Refresh Access Token using valid Refresh Token
 * If valid, returns fresh access token (and rotates refresh token).
 */
async function refreshAccessToken(req, res, next) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required.',
      });
    }

    // 1. Verify token signature
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Refresh token expired or invalid. Please login again.',
      });
    }

    // 2. Check if token is in database and active
    const [records] = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW() LIMIT 1',
      [refreshToken]
    );

    if (records.length === 0) {
      return res.status(401).json({
        success: false,
        code: 'REFRESH_TOKEN_REVOKED',
        message: 'Refresh token has expired or was revoked. Please login again.',
      });
    }

    const tokenRecord = records[0];
    let user;

    if (tokenRecord.user_type === 'STAFF') {
      const [staff] = await pool.query(
        'SELECT * FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1',
        [tokenRecord.user_id]
      );
      if (staff.length === 0) {
        return res.status(401).json({ success: false, message: 'Staff account inactive or not found.' });
      }
      user = staff[0];
    } else {
      const [customers] = await pool.query(
        'SELECT * FROM customers WHERE id = ? AND is_active = 1 LIMIT 1',
        [tokenRecord.user_id]
      );
      if (customers.length === 0) {
        return res.status(401).json({ success: false, message: 'Customer account inactive or not found.' });
      }
      user = customers[0];
    }

    // 3. Token Rotation: Delete old refresh token to prevent replay
    await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [tokenRecord.id]);

    // 4. Issue fresh pair of access and refresh tokens
    const newTokens = await issueTokens(user, tokenRecord.user_type);

    console.log(`🔄 [Token Refresh] Refreshed tokens for ${tokenRecord.user_type} (ID: ${user.id})`);

    return res.status(200).json({
      success: true,
      message: 'Access token refreshed successfully',
      token: newTokens.token,
      refreshToken: newTokens.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 10. Logout and invalidate refresh token
 */
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    }
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 11. Public Staff Directory (Used for Referrals and Staff Dropdown)
 */
async function getStaffDirectory(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, employee_id, full_name, branch_location, role FROM staff_users WHERE is_active = 1 ORDER BY full_name ASC'
    );

    const staffList = rows.map(r => ({
      id: r.id,
      employeeId: r.employee_id,
      fullName: r.full_name,
      branch: r.branch_location,
      role: r.role,
    }));

    return res.status(200).json({
      success: true,
      staff: staffList,
    });
  } catch (err) {
    next(err);
  }
}

async function updateCustomerProfile(req, res, next) {
  try {
    const { phoneNumber, fullName, email, address, dateOfBirth } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required to update profile' });
    }
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const last10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

    const [existing] = await pool.query('SELECT id FROM customers WHERE phone_number LIKE ? LIMIT 1', [`%${last10}`]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer account not found. Please register first.',
      });
    }

    const customerId = existing[0].id;

    // Strict uniqueness check: Email cannot belong to another account
    if (email && email.trim().length > 0) {
      const cleanEmail = email.trim();
      const [existingEmail] = await pool.query(
        'SELECT id FROM customers WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1',
        [cleanEmail, customerId]
      );
      if (existingEmail.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'This email address is already in use by another account.',
        });
      }
    }

    await pool.query(
      `UPDATE customers SET 
         full_name = COALESCE(?, full_name),
         email = COALESCE(?, email),
         address = COALESCE(?, address),
         date_of_birth = COALESCE(?, date_of_birth)
       WHERE id = ?`,
      [fullName?.trim() || null, email?.trim() || null, address?.trim() || null, dateOfBirth || null, customerId]
    );

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully!',
      customer: { id: customerId, fullName, phoneNumber: last10, email, address, dateOfBirth },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 11. Staff Profile Update (Name, Email, Assigned Branch)
 */
async function updateStaffProfile(req, res, next) {
  try {
    const { employeeId, id, fullName, email, phone, branch, branchLocation } = req.body;
    const staffLookupId = id || req.staff?.id;
    const staffLookupEmpId = employeeId || req.staff?.employeeId;

    if (!staffLookupId && !staffLookupEmpId && !phone && !email) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID, phone, or token is required to update profile.',
      });
    }

    const [existing] = await pool.query(
      `SELECT * FROM staff_users 
       WHERE (id = ? OR employee_id = ? OR phone_number = ? OR email = ?) 
       LIMIT 1`,
      [staffLookupId || 0, staffLookupEmpId || '', phone || '', email || '']
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Staff account not found.',
      });
    }

    const currentStaff = existing[0];
    const newEmail = email ? email.trim() : currentStaff.email;

    // Strict uniqueness check: If email changed, check conflict with other staff
    if (newEmail && newEmail.toLowerCase() !== currentStaff.email.toLowerCase()) {
      const [emailConflict] = await pool.query(
        'SELECT id FROM staff_users WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1',
        [newEmail, currentStaff.id]
      );
      if (emailConflict.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'An employee account with this email address already exists.',
        });
      }
    }

    const finalName = fullName ? fullName.trim() : currentStaff.full_name;
    const finalBranch = (branchLocation || branch || '').trim() || currentStaff.branch_location;

    await pool.query(
      `UPDATE staff_users SET
         full_name = ?,
         email = ?,
         branch_location = ?
       WHERE id = ?`,
      [finalName, newEmail, finalBranch, currentStaff.id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM staff_users WHERE id = ?', [currentStaff.id]);
    const updated = updatedRows[0];

    return res.status(200).json({
      success: true,
      message: 'Staff profile updated successfully!',
      staff: {
        id: updated.id,
        employeeId: updated.employee_id,
        fullName: updated.full_name,
        email: updated.email,
        phone: updated.phone_number,
        branch: updated.branch_location,
        role: updated.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  loginWithPassword,
  sendOtp,
  loginWithOtp,
  registerPasswordWithOtp,
  getProfile,
  getStaffDirectory,
  sendCustomerOtp,
  loginCustomerWithOtp,
  registerCustomer,
  updateCustomerProfile,
  updateStaffProfile,
  refreshAccessToken,
  logout,
};
