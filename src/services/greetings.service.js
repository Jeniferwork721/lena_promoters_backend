const cron = require('node-cron');
const { pool } = require('../config/db');
const { getTransporter } = require('./email.service');

/**
 * Returns today's day, month, and year in Indian Standard Time (Asia/Kolkata).
 */
function getTodayIST() {
  const now = new Date();
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric' };
  const formatter = new Intl.DateTimeFormat('en-IN', options);
  const parts = formatter.formatToParts(now);
  const day = parseInt(parts.find(p => p.type === 'day').value, 10);
  const month = parseInt(parts.find(p => p.type === 'month').value, 10);
  const year = parseInt(parts.find(p => p.type === 'year').value, 10);
  return { day, month, year };
}

/**
 * Checks if a given date value (Date object, YYYY-MM-DD, or DD/MM/YYYY) matches targetMonth and targetDay.
 */
function matchesDate(dateVal, targetMonth, targetDay) {
  if (!dateVal) return false;
  if (dateVal instanceof Date) {
    return (dateVal.getMonth() + 1) === targetMonth && dateVal.getDate() === targetDay;
  }
  const str = dateVal.toString().trim();
  if (!str) return false;

  // Try YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    return m === targetMonth && d === targetDay;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (ddmmyyyy) {
    const d = parseInt(ddmmyyyy[1], 10);
    const m = parseInt(ddmmyyyy[2], 10);
    return m === targetMonth && d === targetDay;
  }

  return false;
}

/**
 * Generates responsive branded HTML email for Customer Birthday.
 */
function getCustomerBirthdayHtml(name) {
  const currentYear = new Date().getFullYear();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Happy Birthday!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6fa; margin: 0; padding: 24px; color: #1e293b; }
    .wrapper { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(10,22,39,0.08); border: 1px solid #e9edf4; }
    .header { background: linear-gradient(135deg, #0A1627 0%, #162E50 60%, #1F3E6C 100%); padding: 40px 30px; text-align: center; position: relative; }
    .gold-pill { display: inline-block; background: rgba(200,155,60,0.18); border: 1px solid #C89B3C; color: #E8BF60; padding: 5px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; }
    .brand-title { color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 1px; margin: 0 0 6px 0; }
    .brand-subtitle { color: #C89B3C; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; margin: 0; }
    .banner-graphic { text-align: center; padding: 32px 24px 10px; }
    .cake-icon { font-size: 54px; line-height: 1; }
    .content { padding: 10px 36px 36px; text-align: center; }
    .greeting-h1 { font-size: 24px; font-weight: 800; color: #0A1627; margin: 12px 0 10px; }
    .greeting-name { color: #C89B3C; }
    .message-text { font-size: 15px; line-height: 1.7; color: #475569; margin: 16px 0 24px; }
    .quote-box { background: #faf8f3; border-left: 4px solid #C89B3C; border-radius: 8px; padding: 16px 20px; text-align: left; margin: 24px 0; }
    .quote-text { font-size: 14px; font-style: italic; color: #334155; margin: 0; line-height: 1.6; }
    .signature { margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: center; }
    .sign-name { font-size: 15px; font-weight: 700; color: #0A1627; margin: 0; }
    .sign-role { font-size: 13px; color: #64748b; margin: 3px 0 0; }
    .footer { background: #f8fafc; padding: 22px 28px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #eef2f7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="gold-pill">Special Celebration</span>
      <div class="brand-title">LENA PROMOTERS</div>
      <div class="brand-subtitle">DTCP Approved Plots & Premium Investments</div>
    </div>
    <div class="banner-graphic">
      <div class="cake-icon">🎂🎉</div>
    </div>
    <div class="content">
      <h1 class="greeting-h1">Happy Birthday, <span class="greeting-name">${name}</span>!</h1>
      <p class="message-text">
        On this wonderful day, the entire family at <strong>Lena Promoters</strong> wishes you boundless happiness, excellent health, success, and prosperity in all your endeavours.
      </p>
      <div class="quote-box">
        <p class="quote-text">
          "May this new year of your life bring abundant opportunities, cherished memories, and dreams fulfilled. Thank you for being an esteemed part of the Lena Promoters family!"
        </p>
      </div>
      <p class="message-text" style="margin-bottom: 0;">
        We celebrate you today and look forward to being a part of your prosperous journey for years to come.
      </p>
      <div class="signature">
        <p class="sign-name">Subaramanian</p>
        <p class="sign-role">Managing Director & Team Lena Promoters</p>
      </div>
    </div>
    <div class="footer">
      &copy; ${currentYear} Lena Promoters Pvt Ltd. All rights reserved.<br>
      Karaikudi &bull; Sivagangai &bull; Coimbatore &bull; Tamil Nadu<br>
      <span style="font-size: 11px;">You received this celebration email because you are a registered customer of Lena Promoters.</span>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generates responsive branded HTML email for Customer Wedding Anniversary.
 */
function getCustomerAnniversaryHtml(name) {
  const currentYear = new Date().getFullYear();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Happy Wedding Anniversary!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6fa; margin: 0; padding: 24px; color: #1e293b; }
    .wrapper { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(10,22,39,0.08); border: 1px solid #e9edf4; }
    .header { background: linear-gradient(135deg, #1B0B23 0%, #381442 60%, #501D5E 100%); padding: 40px 30px; text-align: center; }
    .gold-pill { display: inline-block; background: rgba(212,175,55,0.2); border: 1px solid #D4AF37; color: #F2D27A; padding: 5px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; }
    .brand-title { color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 1px; margin: 0 0 6px 0; }
    .brand-subtitle { color: #D4AF37; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; margin: 0; }
    .banner-graphic { text-align: center; padding: 32px 24px 10px; }
    .ring-icon { font-size: 54px; line-height: 1; }
    .content { padding: 10px 36px 36px; text-align: center; }
    .greeting-h1 { font-size: 24px; font-weight: 800; color: #1e293b; margin: 12px 0 10px; }
    .greeting-name { color: #8A2665; }
    .message-text { font-size: 15px; line-height: 1.7; color: #475569; margin: 16px 0 24px; }
    .quote-box { background: #faf4f8; border-left: 4px solid #8A2665; border-radius: 8px; padding: 16px 20px; text-align: left; margin: 24px 0; }
    .quote-text { font-size: 14px; font-style: italic; color: #334155; margin: 0; line-height: 1.6; }
    .signature { margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: center; }
    .sign-name { font-size: 15px; font-weight: 700; color: #0A1627; margin: 0; }
    .sign-role { font-size: 13px; color: #64748b; margin: 3px 0 0; }
    .footer { background: #f8fafc; padding: 22px 28px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #eef2f7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="gold-pill">Milestone Celebration</span>
      <div class="brand-title">LENA PROMOTERS</div>
      <div class="brand-subtitle">DTCP Approved Plots & Premium Investments</div>
    </div>
    <div class="banner-graphic">
      <div class="ring-icon">💍💐</div>
    </div>
    <div class="content">
      <h1 class="greeting-h1">Happy Wedding Anniversary, <span class="greeting-name">${name}</span>!</h1>
      <p class="message-text">
        Hearty congratulations on your special milestone! May your bond of love, trust, and companionship grow deeper and stronger with each passing year.
      </p>
      <div class="quote-box">
        <p class="quote-text">
          "A successful marriage requires falling in love many times, always with the same person. Wishing you a lifetime of laughter, harmony, and togetherness!"
        </p>
      </div>
      <p class="message-text" style="margin-bottom: 0;">
        From all of us at <strong>Lena Promoters</strong>, we wish you and your spouse an unforgettable day and years of shared joy and prosperity ahead.
      </p>
      <div class="signature">
        <p class="sign-name">Subaramanian</p>
        <p class="sign-role">Managing Director & Team Lena Promoters</p>
      </div>
    </div>
    <div class="footer">
      &copy; ${currentYear} Lena Promoters Pvt Ltd. All rights reserved.<br>
      Karaikudi &bull; Sivagangai &bull; Coimbatore &bull; Tamil Nadu
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generates responsive branded HTML email for Staff/Employee Birthday.
 */
function getStaffBirthdayHtml(name, employeeId) {
  const currentYear = new Date().getFullYear();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Happy Birthday, Team Member!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6fa; margin: 0; padding: 24px; color: #1e293b; }
    .wrapper { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(10,22,39,0.08); border: 1px solid #e9edf4; }
    .header { background: linear-gradient(135deg, #0A1627 0%, #153259 100%); padding: 36px 30px; text-align: center; }
    .gold-pill { display: inline-block; background: rgba(200,155,60,0.18); border: 1px solid #C89B3C; color: #E8BF60; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
    .brand-title { color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: 1px; margin: 0; }
    .banner-graphic { text-align: center; padding: 30px 24px 8px; }
    .cake-icon { font-size: 50px; line-height: 1; }
    .content { padding: 10px 36px 32px; text-align: center; }
    .greeting-h1 { font-size: 23px; font-weight: 800; color: #0A1627; margin: 10px 0; }
    .greeting-name { color: #C89B3C; }
    .message-text { font-size: 15px; line-height: 1.7; color: #475569; margin: 16px 0; }
    .appreciation-box { background: #f0f7ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 18px; margin: 20px 0; text-align: left; }
    .appreciation-title { font-weight: 700; color: #1e40af; font-size: 14px; margin-bottom: 6px; }
    .appreciation-body { font-size: 13.5px; color: #334155; margin: 0; line-height: 1.6; }
    .signature { margin-top: 24px; padding-top: 18px; border-top: 1px solid #f1f5f9; text-align: center; }
    .sign-name { font-size: 15px; font-weight: 700; color: #0A1627; margin: 0; }
    .sign-role { font-size: 13px; color: #64748b; margin: 3px 0 0; }
    .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #eef2f7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="gold-pill">Employee Appreciation</span>
      <div class="brand-title">LENA PROMOTERS</div>
    </div>
    <div class="banner-graphic">
      <div class="cake-icon">🎂⭐</div>
    </div>
    <div class="content">
      <h1 class="greeting-h1">Happy Birthday, <span class="greeting-name">${name}</span>!</h1>
      <p class="message-text">
        Today, the entire management and team at <strong>Lena Promoters</strong> celebrate you!
      </p>
      <div class="appreciation-box">
        <div class="appreciation-title">🌟 You are a Valued Team Member ${employeeId ? `(${employeeId})` : ''}</div>
        <div class="appreciation-body">
          Your hard work, commitment, and positive energy play a crucial role in our collective success. We truly appreciate everything you contribute to Lena Promoters every single day.
        </div>
      </div>
      <p class="message-text" style="margin-bottom: 0;">
        Wishing you a fantastic birthday filled with laughter, great memories with your loved ones, and continuous career growth in the year ahead!
      </p>
      <div class="signature">
        <p class="sign-name">Subaramanian & Management Team</p>
        <p class="sign-role">Lena Promoters Family</p>
      </div>
    </div>
    <div class="footer">
      &copy; ${currentYear} Lena Promoters Pvt Ltd. All rights reserved.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generates responsive branded HTML email for Staff/Employee Wedding Anniversary.
 */
function getStaffAnniversaryHtml(name, employeeId) {
  const currentYear = new Date().getFullYear();
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Happy Wedding Anniversary!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6fa; margin: 0; padding: 24px; color: #1e293b; }
    .wrapper { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(10,22,39,0.08); border: 1px solid #e9edf4; }
    .header { background: linear-gradient(135deg, #162E50 0%, #2B4C7E 100%); padding: 36px 30px; text-align: center; }
    .gold-pill { display: inline-block; background: rgba(200,155,60,0.2); border: 1px solid #C89B3C; color: #E8BF60; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
    .brand-title { color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: 1px; margin: 0; }
    .banner-graphic { text-align: center; padding: 30px 24px 8px; }
    .ring-icon { font-size: 50px; line-height: 1; }
    .content { padding: 10px 36px 32px; text-align: center; }
    .greeting-h1 { font-size: 23px; font-weight: 800; color: #0A1627; margin: 10px 0; }
    .greeting-name { color: #C89B3C; }
    .message-text { font-size: 15px; line-height: 1.7; color: #475569; margin: 16px 0; }
    .quote-box { background: #faf8f3; border-left: 4px solid #C89B3C; border-radius: 8px; padding: 16px 20px; text-align: left; margin: 20px 0; }
    .quote-text { font-size: 13.5px; font-style: italic; color: #334155; margin: 0; line-height: 1.6; }
    .signature { margin-top: 24px; padding-top: 18px; border-top: 1px solid #f1f5f9; text-align: center; }
    .sign-name { font-size: 15px; font-weight: 700; color: #0A1627; margin: 0; }
    .sign-role { font-size: 13px; color: #64748b; margin: 3px 0 0; }
    .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #eef2f7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="gold-pill">Anniversary Wishes</span>
      <div class="brand-title">LENA PROMOTERS</div>
    </div>
    <div class="banner-graphic">
      <div class="ring-icon">💍✨</div>
    </div>
    <div class="content">
      <h1 class="greeting-h1">Happy Wedding Anniversary, <span class="greeting-name">${name}</span>!</h1>
      <p class="message-text">
        The management and all your colleagues at <strong>Lena Promoters</strong> send warmest congratulations to you and your spouse on your wedding anniversary!
      </p>
      <div class="quote-box">
        <p class="quote-text">
          "Wishing you both endless love, harmony, good health, and abundant blessings as you celebrate another beautiful milestone together."
        </p>
      </div>
      <p class="message-text" style="margin-bottom: 0;">
        Have a wonderful anniversary celebration with your family!
      </p>
      <div class="signature">
        <p class="sign-name">Subaramanian & Team Lena Promoters</p>
        <p class="sign-role">Management & Colleagues</p>
      </div>
    </div>
    <div class="footer">
      &copy; ${currentYear} Lena Promoters Pvt Ltd. All rights reserved.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Sends a single greeting email to a recipient and logs the record in automated_greeting_logs.
 */
async function sendGreetingEmail({ recipientType, recipientId, fullName, email, greetingType, employeeId = '' }) {
  const { day, month, year } = getTodayIST();
  const eventDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  if (!email || !email.includes('@')) {
    return { success: false, skipped: true, reason: 'Invalid or missing email' };
  }

  // Check if already sent for this recipient and greeting type in the current year
  try {
    const [existing] = await pool.query(
      `SELECT id, status FROM automated_greeting_logs 
       WHERE recipient_type = ? AND recipient_id = ? AND greeting_type = ? AND sent_year = ? LIMIT 1`,
      [recipientType, recipientId, greetingType, year]
    );

    if (existing.length > 0 && existing[0].status === 'SENT') {
      return { success: true, skipped: true, reason: `Already sent for year ${year}` };
    }
  } catch (err) {
    console.error('Error checking existing greeting log:', err.message);
  }

  const transporter = getTransporter();
  const senderUser = process.env.EMAIL_USER || 'noreply@lenapromoters.com';

  let subject = '';
  let html = '';
  let text = '';

  if (greetingType === 'BIRTHDAY') {
    if (recipientType === 'CUSTOMER') {
      subject = `🎉 Happy Birthday ${fullName}! Warm Wishes from Lena Promoters`;
      html = getCustomerBirthdayHtml(fullName);
      text = `Dear ${fullName},\n\nHappy Birthday! Wishing you abundant happiness, good health, and success.\n\nWarm regards,\nSubaramanian\nManaging Director & Team Lena Promoters`;
    } else {
      subject = `🎂 Happy Birthday ${fullName}! Warm Wishes from Lena Promoters Family`;
      html = getStaffBirthdayHtml(fullName, employeeId);
      text = `Dear ${fullName},\n\nHappy Birthday! We appreciate your commitment and dedication to Lena Promoters.\n\nWarm regards,\nManagement Team, Lena Promoters`;
    }
  } else if (greetingType === 'ANNIVERSARY') {
    if (recipientType === 'CUSTOMER') {
      subject = `💍 Happy Wedding Anniversary ${fullName}! Wishes from Lena Promoters`;
      html = getCustomerAnniversaryHtml(fullName);
      text = `Dear ${fullName},\n\nHappy Wedding Anniversary! Wishing you and your spouse endless love, joy, and togetherness.\n\nWarm regards,\nSubaramanian\nManaging Director & Team Lena Promoters`;
    } else {
      subject = `💐 Happy Wedding Anniversary ${fullName}! Congratulations from Lena Promoters`;
      html = getStaffAnniversaryHtml(fullName, employeeId);
      text = `Dear ${fullName},\n\nHappy Wedding Anniversary! Warmest congratulations from all your colleagues and management at Lena Promoters.\n\nWarm regards,\nLena Promoters Family`;
    }
  }

  // If email transporter is not configured (e.g. local dev without SMTP creds)
  if (!transporter) {
    console.log(`[Greeting Gateway] (Simulated) Would send ${greetingType} greeting to ${recipientType} ${fullName} <${email}>`);
    try {
      await pool.query(
        `INSERT INTO automated_greeting_logs 
         (recipient_type, recipient_id, recipient_name, recipient_email, greeting_type, event_date, sent_year, status, message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'DEV_SIMULATED', 'SIMULATED-DEV-ENV')
         ON DUPLICATE KEY UPDATE status = 'DEV_SIMULATED', message_id = 'SIMULATED-DEV-ENV', sent_at = CURRENT_TIMESTAMP`,
        [recipientType, recipientId, fullName, email, greetingType, eventDateStr, year]
      );
    } catch (_) {}
    return { success: true, simulated: true, message: 'EMAIL_USER not set in .env (Simulated)' };
  }

  const mailOptions = {
    from: `"Lena Promoters" <${senderUser}>`,
    to: email,
    subject,
    text,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [Greetings] ${greetingType} email delivered to ${recipientType} ${fullName} <${email}>. Message ID: ${info.messageId}`);

    await pool.query(
      `INSERT INTO automated_greeting_logs 
       (recipient_type, recipient_id, recipient_name, recipient_email, greeting_type, event_date, sent_year, status, message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', ?)
       ON DUPLICATE KEY UPDATE status = 'SENT', message_id = VALUES(message_id), error_message = NULL, sent_at = CURRENT_TIMESTAMP`,
      [recipientType, recipientId, fullName, email, greetingType, eventDateStr, year, info.messageId]
    );

    return { success: true, delivered: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ [Greetings] Failed sending ${greetingType} to ${email}:`, err.message);

    try {
      await pool.query(
        `INSERT INTO automated_greeting_logs 
         (recipient_type, recipient_id, recipient_name, recipient_email, greeting_type, event_date, sent_year, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'FAILED', ?)
         ON DUPLICATE KEY UPDATE status = 'FAILED', error_message = VALUES(error_message), sent_at = CURRENT_TIMESTAMP`,
        [recipientType, recipientId, fullName, email, greetingType, eventDateStr, year, err.message]
      );
    } catch (_) {}

    return { success: false, error: err.message };
  }
}

/**
 * Executes daily greeting check for both Customers and Staff.
 * Safe to call multiple times because sent_year unique key prevents duplicate sends.
 */
async function processDailyGreetings() {
  const { day, month, year } = getTodayIST();
  console.log(`🎈 [Daily Greetings Scheduler] Running for date: ${year}-${month}-${day} (IST)...`);

  const results = {
    customers: { birthdaySent: 0, anniversarySent: 0, skipped: 0, failed: 0 },
    staff: { birthdaySent: 0, anniversarySent: 0, skipped: 0, failed: 0 },
  };

  try {
    // 1. Process Customers
    const [customers] = await pool.query(
      `SELECT id, full_name, email, date_of_birth, marriage_date 
       FROM customers 
       WHERE email IS NOT NULL AND TRIM(email) != '' AND is_active = 1`
    );

    for (const c of customers) {
      // Birthday check
      if (matchesDate(c.date_of_birth, month, day)) {
        const res = await sendGreetingEmail({
          recipientType: 'CUSTOMER',
          recipientId: c.id,
          fullName: c.full_name,
          email: c.email.trim(),
          greetingType: 'BIRTHDAY',
        });
        if (res.delivered || res.simulated) results.customers.birthdaySent++;
        else if (res.skipped) results.customers.skipped++;
        else results.customers.failed++;
      }

      // Wedding Anniversary check
      if (matchesDate(c.marriage_date, month, day)) {
        const res = await sendGreetingEmail({
          recipientType: 'CUSTOMER',
          recipientId: c.id,
          fullName: c.full_name,
          email: c.email.trim(),
          greetingType: 'ANNIVERSARY',
        });
        if (res.delivered || res.simulated) results.customers.anniversarySent++;
        else if (res.skipped) results.customers.skipped++;
        else results.customers.failed++;
      }
    }

    // 2. Process Staff
    const [staffList] = await pool.query(
      `SELECT id, employee_id, full_name, email, dob, marriage_date 
       FROM staff_users 
       WHERE email IS NOT NULL AND TRIM(email) != '' AND is_active = 1`
    );

    for (const s of staffList) {
      // Birthday check
      if (matchesDate(s.dob, month, day)) {
        const res = await sendGreetingEmail({
          recipientType: 'STAFF',
          recipientId: s.id,
          fullName: s.full_name,
          email: s.email.trim(),
          greetingType: 'BIRTHDAY',
          employeeId: s.employee_id,
        });
        if (res.delivered || res.simulated) results.staff.birthdaySent++;
        else if (res.skipped) results.staff.skipped++;
        else results.staff.failed++;
      }

      // Wedding Anniversary check
      if (matchesDate(s.marriage_date, month, day)) {
        const res = await sendGreetingEmail({
          recipientType: 'STAFF',
          recipientId: s.id,
          fullName: s.full_name,
          email: s.email.trim(),
          greetingType: 'ANNIVERSARY',
          employeeId: s.employee_id,
        });
        if (res.delivered || res.simulated) results.staff.anniversarySent++;
        else if (res.skipped) results.staff.skipped++;
        else results.staff.failed++;
      }
    }

    console.log('✅ [Daily Greetings Scheduler] Execution completed:', JSON.stringify(results));
  } catch (err) {
    console.error('❌ [Daily Greetings Scheduler] Error running daily greetings:', err.message);
  }

  return results;
}

/**
 * Returns today's celebrations (birthdays & anniversaries) for CRM dashboard display.
 */
async function getTodayCelebrations() {
  const { day, month, year } = getTodayIST();
  const celebrations = [];

  try {
    // 1. Customers
    const [customers] = await pool.query(
      `SELECT id, full_name, email, phone_number, date_of_birth, marriage_date 
       FROM customers 
       WHERE is_active = 1`
    );

    for (const c of customers) {
      if (matchesDate(c.date_of_birth, month, day)) {
        celebrations.push({
          recipientType: 'CUSTOMER',
          recipientId: c.id,
          fullName: c.full_name,
          email: c.email || '',
          phone: c.phone_number || '',
          greetingType: 'BIRTHDAY',
          eventTitle: `${c.full_name}'s Birthday`,
          hasEmail: Boolean(c.email && c.email.includes('@')),
        });
      }
      if (matchesDate(c.marriage_date, month, day)) {
        celebrations.push({
          recipientType: 'CUSTOMER',
          recipientId: c.id,
          fullName: c.full_name,
          email: c.email || '',
          phone: c.phone_number || '',
          greetingType: 'ANNIVERSARY',
          eventTitle: `${c.full_name}'s Wedding Anniversary`,
          hasEmail: Boolean(c.email && c.email.includes('@')),
        });
      }
    }

    // 2. Staff
    const [staffList] = await pool.query(
      `SELECT id, employee_id, full_name, email, phone_number, branch_location, dob, marriage_date 
       FROM staff_users 
       WHERE is_active = 1`
    );

    for (const s of staffList) {
      if (matchesDate(s.dob, month, day)) {
        celebrations.push({
          recipientType: 'STAFF',
          recipientId: s.id,
          employeeId: s.employee_id,
          fullName: s.full_name,
          email: s.email || '',
          phone: s.phone_number || '',
          branch: s.branch_location || '',
          greetingType: 'BIRTHDAY',
          eventTitle: `${s.full_name}'s Birthday`,
          hasEmail: Boolean(s.email && s.email.includes('@')),
        });
      }
      if (matchesDate(s.marriage_date, month, day)) {
        celebrations.push({
          recipientType: 'STAFF',
          recipientId: s.id,
          employeeId: s.employee_id,
          fullName: s.full_name,
          email: s.email || '',
          phone: s.phone_number || '',
          branch: s.branch_location || '',
          greetingType: 'ANNIVERSARY',
          eventTitle: `${s.full_name}'s Wedding Anniversary`,
          hasEmail: Boolean(s.email && s.email.includes('@')),
        });
      }
    }

    // Attach delivery status from logs
    if (celebrations.length > 0) {
      const [logs] = await pool.query(
        `SELECT recipient_type, recipient_id, greeting_type, status, sent_at 
         FROM automated_greeting_logs 
         WHERE sent_year = ?`,
        [year]
      );

      const logMap = new Map();
      for (const log of logs) {
        logMap.set(`${log.recipient_type}_${log.recipient_id}_${log.greeting_type}`, log);
      }

      for (const item of celebrations) {
        const key = `${item.recipientType}_${item.recipientId}_${item.greetingType}`;
        const record = logMap.get(key);
        item.emailStatus = record ? record.status : 'NOT_SENT';
        item.sentAt = record ? record.sent_at : null;
      }
    }
  } catch (err) {
    console.error('Error fetching today celebrations:', err.message);
  }

  return celebrations;
}

/**
 * Initializes the automated daily scheduler at 08:00 AM IST.
 */
function initGreetingsScheduler() {
  // Cron expression: 0 8 * * * = Every day at 08:00 AM
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('⏰ [Daily Greetings Scheduler] Triggering 08:00 AM IST automated wish dispatch...');
      await processDailyGreetings();
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );

  console.log('📅 [Greetings Scheduler] Daily birthday & anniversary wish scheduler active (08:00 AM IST)');
}

module.exports = {
  processDailyGreetings,
  sendGreetingEmail,
  getTodayCelebrations,
  initGreetingsScheduler,
  getTodayIST,
};
