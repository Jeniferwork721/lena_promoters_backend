const nodemailer = require('nodemailer');

/**
 * Creates and returns the Nodemailer transporter instance.
 * Supports Gmail (with App Password) or custom SMTP.
 */
function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    return null;
  }

  // If custom SMTP is provided
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
      auth: { user, pass },
    });
  }

  // Default: Gmail service with App Password
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: { user, pass },
  });
}

/**
 * Send an OTP verification code to an email address.
 *
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - 4-digit verification code
 * @param {string} purpose - 'STAFF_REGISTER', 'STAFF_LOGIN', 'CUSTOMER_AUTH'
 * @returns {Promise<{success: boolean, isLiveEmail: boolean, message: string}>}
 */
async function sendEmailOtp(toEmail, otp, purpose = 'STAFF_LOGIN') {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(
      `⚠️ [Email Gateway] EMAIL_USER or EMAIL_PASS not set in .env. ` +
      `Real email cannot be sent yet. Dev code for ${toEmail} is: ${otp}`
    );
    return {
      success: true,
      isLiveEmail: false,
      message: 'Email service credentials (EMAIL_USER / EMAIL_PASS) not configured in .env.',
    };
  }

  const purposeTitle =
    purpose === 'STAFF_REGISTER'
      ? 'Staff Account Registration'
      : purpose === 'STAFF_FORGOT_PASSWORD' || purpose === 'PASSWORD_RESET'
      ? 'Staff Password Reset'
      : purpose === 'STAFF_LOGIN'
      ? 'Staff Portal Login'
      : 'Investor Verification';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f6f8fb; margin: 0; padding: 24px; }
        .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #0A1627, #142B4A); padding: 32px 24px; text-align: center; }
        .header h1 { color: #C89B3C; margin: 0 0 6px 0; font-size: 24px; letter-spacing: 0.5px; }
        .header p { color: #E8EEF5; margin: 0; font-size: 13px; opacity: 0.9; }
        .body { padding: 32px 28px; text-align: center; color: #1e293b; }
        .badge { display: inline-block; background: #f1f5f9; color: #142B4A; font-weight: 700; font-size: 11px; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .code-box { background: #f8fafc; border: 2px dashed #C89B3C; border-radius: 12px; padding: 18px 24px; margin: 24px 0; display: inline-block; }
        .code { font-size: 36px; font-weight: 800; color: #142B4A; letter-spacing: 10px; margin: 0; }
        .notice { font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 16px; }
        .footer { background: #f8fafc; padding: 18px 24px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>LENA PROMOTERS</h1>
          <p>Premier DTCP Approved Plots & Investments</p>
        </div>
        <div class="body">
          <span class="badge">${purposeTitle}</span>
          <h2 style="margin: 0 0 10px 0; color: #0f172a; font-size: 19px;">Your Verification Code</h2>
          <p style="margin: 0; color: #475569; font-size: 14px;">Use the 4-digit code below to complete your authentication:</p>
          <div class="code-box">
            <div class="code">${otp}</div>
          </div>
          <p class="notice">
            This verification code is valid for <strong>10 minutes</strong>.<br>
            If you did not request this code, please ignore this email or contact Lena Promoters IT administrator immediately.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} Lena Promoters Pvt Ltd. All rights reserved.<br>
          Karaikudi &bull; Sivagangai &bull; Coimbatore &bull; Tamil Nadu
        </div>
      </div>
    </body>
    </html>
  `;

  const senderUser = process.env.EMAIL_USER;
  const mailOptions = {
    from: `"Lena Promoters" <${senderUser}>`,
    to: toEmail,
    subject: `${otp} is your Lena Promoters Verification Code`,
    text: `Your Lena Promoters verification code for ${purposeTitle} is: ${otp}. Valid for 10 minutes.`,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [Email Gateway] Live email delivered to ${toEmail}. Message ID: ${info.messageId}`);
    return {
      success: true,
      isLiveEmail: true,
      message: `Verification code sent to ${toEmail}.`,
    };
  } catch (err) {
    console.error(`❌ [Email Gateway] Failed to send email to ${toEmail}:`, err.message);
    return {
      success: false,
      isLiveEmail: false,
      message: `Failed to deliver email: ${err.message}`,
    };
  }
}

/**
 * Send welcome email to a new staff member with their email and temporary password.
 *
 * @param {string} toEmail - Staff email address
 * @param {string} fullName - Staff name
 * @param {string} temporaryPassword - Temporary password (e.g. Lena@1234)
 * @param {string} roleName - Display role (e.g. 'Team Lead', 'Employee')
 * @param {string} employeeId - Generated employee ID (e.g. 'LP-EMP-105')
 */
async function sendStaffWelcomeEmail(toEmail, fullName, temporaryPassword = 'Lena@1234', roleName = 'Staff', employeeId = '') {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(
      `⚠️ [Email Gateway] EMAIL_USER / EMAIL_PASS not configured in .env. ` +
      `Welcome email skipped. Credentials for ${toEmail}: Password: ${temporaryPassword}`
    );
    return {
      success: true,
      isLiveEmail: false,
      message: 'Email credentials not configured in .env.',
    };
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f6f8fb; margin: 0; padding: 24px; }
        .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #0A1627, #142B4A); padding: 28px 24px; text-align: center; }
        .header h1 { color: #C89B3C; margin: 0 0 6px 0; font-size: 22px; letter-spacing: 0.5px; }
        .header p { color: #E8EEF5; margin: 0; font-size: 13px; opacity: 0.9; }
        .body { padding: 28px 24px; color: #1e293b; }
        .cred-box { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin: 20px 0; }
        .cred-row { margin-bottom: 12px; font-size: 14px; }
        .cred-row:last-child { margin-bottom: 0; }
        .cred-label { font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .cred-val { font-size: 16px; font-weight: 700; color: #0f172a; font-family: monospace; }
        .footer { background: #f8fafc; padding: 16px 20px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>LENA PROMOTERS CRM</h1>
          <p>Welcome to the Team</p>
        </div>
        <div class="body">
          <p style="font-size: 15px; margin: 0 0 14px 0; color: #334155;">Hello <strong>${fullName || 'Team Member'}</strong>,</p>
          <p style="font-size: 14px; line-height: 1.5; color: #475569; margin: 0 0 16px 0;">
            Your account has been created for Lena Promoters CRM. This is your email and your temporary password:
          </p>
          <div class="cred-box">
            ${employeeId ? `
            <div class="cred-row">
              <div class="cred-label">Employee ID</div>
              <div class="cred-val">${employeeId}</div>
            </div>` : ''}
            <div class="cred-row">
              <div class="cred-label">Email Address</div>
              <div class="cred-val">${toEmail}</div>
            </div>
            <div class="cred-row">
              <div class="cred-label">Temporary Password</div>
              <div class="cred-val" style="color: #0284c7;">${temporaryPassword}</div>
            </div>
          </div>
          <p style="font-size: 13.5px; color: #64748b; line-height: 1.6; margin: 0;">
            Please log in to the Lena Promoters mobile app or web portal using this temporary password and set your permanent password.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} Lena Promoters Pvt Ltd. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  const senderUser = process.env.EMAIL_USER;
  const mailOptions = {
    from: `"Lena Promoters CRM" <${senderUser}>`,
    to: toEmail,
    subject: `Your Lena Promoters CRM Login Credentials`,
    text: `Hello ${fullName},\n\nYour account has been created for Lena Promoters CRM.\n\nEmail: ${toEmail}\nUsername/Employee ID: ${employeeId}\nTemporary Password: ${temporaryPassword}\n\nPlease log in to the Lena Promoters mobile app or web portal and set your permanent password.`,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [Email Gateway] Welcome email delivered to ${toEmail}. Message ID: ${info.messageId}`);
    return {
      success: true,
      isLiveEmail: true,
      message: `Login credentials sent to ${toEmail}.`,
    };
  } catch (err) {
    console.error(`❌ [Email Gateway] Failed to send welcome email to ${toEmail}:`, err.message);
    return {
      success: false,
      isLiveEmail: false,
      message: `Failed to deliver welcome email: ${err.message}`,
    };
  }
}

module.exports = {
  sendEmailOtp,
  sendStaffWelcomeEmail,
};
