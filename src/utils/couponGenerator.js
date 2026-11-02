const { pool } = require('../config/db');

/**
 * Generates an array of continuous sequential Lucky Draw coupon numbers.
 * e.g. ['LENA-LD-8807', 'LENA-LD-8808', ...]
 */
async function generateNextCouponNumbers(count = 1) {
  const safeCount = Math.max(1, parseInt(count, 10) || 1);

  // Scan all existing coupons in database to find highest numeric token
  const [rows] = await pool.query(
    'SELECT coupon_number FROM lucky_draw_coupons WHERE coupon_number LIKE "LENA-LD-%"'
  );

  let maxNumber = 8800;
  for (const r of rows) {
    const digits = r.coupon_number.replace(/^LENA-LD-/i, '');
    const num = parseInt(digits, 10);
    if (!isNaN(num) && num > maxNumber) {
      maxNumber = num;
    }
  }

  const generated = [];
  let candidate = maxNumber + 1;
  while (generated.length < safeCount) {
    const candidateStr = `LENA-LD-${candidate}`;
    const [found] = await pool.query(
      'SELECT id FROM lucky_draw_coupons WHERE coupon_number = ?',
      [candidateStr]
    );
    if (found.length === 0) {
      generated.push(candidateStr);
    }
    candidate++;
  }

  return generated;
}

/**
 * Generates single next sequential Lucky Draw coupon number.
 */
async function generateNextCouponNumber(customNumber = null) {
  // If customNumber is explicitly provided and is free, use it
  if (customNumber && typeof customNumber === 'string' && customNumber.trim().length > 0) {
    const formatted = customNumber.trim().toUpperCase();
    const [existing] = await pool.query(
      'SELECT id FROM lucky_draw_coupons WHERE coupon_number = ?',
      [formatted]
    );
    if (existing.length === 0) {
      return formatted;
    }
    console.log(`ℹ️ [Coupon Generator] Requested number ${formatted} is already assigned. Finding next sequential token.`);
  }

  const [single] = await generateNextCouponNumbers(1);
  return single;
}

module.exports = {
  generateNextCouponNumber,
  generateNextCouponNumbers,
};
