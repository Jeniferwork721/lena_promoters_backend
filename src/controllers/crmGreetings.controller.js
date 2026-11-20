const greetingsService = require('../services/greetings.service');

/**
 * GET /crm/greetings/today
 * Returns all customers and staff celebrating their birthday or anniversary today,
 * along with the email delivery status.
 */
async function getTodayCelebrations(req, res, next) {
  try {
    const celebrations = await greetingsService.getTodayCelebrations();
    return res.json({
      success: true,
      count: celebrations.length,
      data: celebrations,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /crm/greetings/trigger
 * Manually or on-demand trigger the daily greetings email dispatch.
 */
async function triggerDailyGreetings(req, res, next) {
  try {
    const results = await greetingsService.processDailyGreetings();
    return res.json({
      success: true,
      message: 'Daily greetings process executed successfully',
      results,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /crm/greetings/send-single
 * Manually send or resend a wish to an individual recipient.
 */
async function sendSingleGreeting(req, res, next) {
  try {
    const { recipientType, recipientId, fullName, email, greetingType, employeeId } = req.body;

    if (!recipientType || !recipientId || !email || !greetingType) {
      return res.status(400).json({
        success: false,
        message: 'recipientType, recipientId, email, and greetingType are required',
      });
    }

    const result = await greetingsService.sendGreetingEmail({
      recipientType,
      recipientId: parseInt(recipientId, 10),
      fullName: fullName || 'Valued Member',
      email: email.trim(),
      greetingType,
      employeeId,
    });

    return res.json({
      success: result.success,
      result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTodayCelebrations,
  triggerDailyGreetings,
  sendSingleGreeting,
};
