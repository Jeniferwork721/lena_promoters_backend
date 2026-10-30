/**
 * 2Factor.in SMS Gateway Integration
 * Supports live transactional SMS OTP for Indian mobile numbers using 2Factor free trial/paid API.
 */
async function sendSmsOtp(phoneNumber, otp) {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.trim() === 'your_2factor_api_key_here') {
    console.log(`ℹ️ [2Factor SMS Gateway] No TWO_FACTOR_API_KEY configured in .env. Dev OTP for ${phoneNumber} is: ${otp}`);
    return { success: true, isDev: true, message: `Dev OTP: ${otp}` };
  }

  // Sanitize 10-digit Indian mobile number
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  const targetPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;

  try {
    // 2Factor standard approved DLT transactional template is 'OTP1'
    const url = `https://2factor.in/API/V1/${apiKey.trim()}/SMS/${targetPhone}/${otp}/OTP1`;
    console.log(`📡 [2Factor SMS Gateway] Dispatching live SMS OTP via template OTP1 to +91${targetPhone}...`);

    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (data && (data.Status === 'Success' || data.status === 'success')) {
      console.log(`✅ [2Factor SMS Gateway] Live SMS delivered successfully to ${targetPhone}. Session: ${data.Details}`);
      return { success: true, details: data.Details, isLiveSms: true };
    } else {
      console.warn(`⚠️ [2Factor SMS Gateway OTP1] Response:`, data);
      // Fallback to plain custom OTP endpoint if OTP1 template had an issue
      const fallbackUrl = `https://2factor.in/API/V1/${apiKey.trim()}/SMS/${targetPhone}/${otp}`;
      const fallbackRes = await fetch(fallbackUrl, { method: 'GET' });
      const fallbackData = await fallbackRes.json();
      if (fallbackData && (fallbackData.Status === 'Success' || fallbackData.status === 'success')) {
        return { success: true, details: fallbackData.Details, isLiveSms: true };
      }
      return { success: false, message: data?.Details || fallbackData?.Details || 'SMS gateway rejected request' };
    }
  } catch (err) {
    console.error(`❌ [2Factor SMS Gateway Error]:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendSmsOtp };
