const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');

/**
 * 1. GET /api/v1/daily-posts/recent
 * Public endpoint for Customer Mobile App:
 * Returns up to 7 posts from the past week (1-week carousel).
 */
async function getRecentDailyPosts(req, res, next) {
  try {
    // Attempt to fetch posts within the past 7 days (CURDATE() - 7 days up to today)
    let [rows] = await pool.query(
      `SELECT id, DATE_FORMAT(post_date, '%Y-%m-%d') AS post_date, image_url, caption, created_at, updated_at
       FROM daily_posts
       WHERE post_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND post_date <= CURDATE()
       ORDER BY post_date DESC
       LIMIT 7`
    );

    // If no posts in the last 7 days yet, fetch the most recent up to 7 posts so carousel is populated gracefully
    if (rows.length === 0) {
      const [fallback] = await pool.query(
        `SELECT id, DATE_FORMAT(post_date, '%Y-%m-%d') AS post_date, image_url, caption, created_at, updated_at
         FROM daily_posts
         ORDER BY post_date DESC
         LIMIT 7`
      );
      rows = fallback;
    }

    return res.status(200).json({
      success: true,
      count: rows.length,
      posts: rows,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. GET /api/v1/daily-posts
 * Admin/Staff endpoint for CRM management:
 * List all uploaded posts or check a specific date.
 */
async function getAllDailyPosts(req, res, next) {
  try {
    const { date, limit = 50 } = req.query;

    if (date) {
      const [rows] = await pool.query(
        `SELECT id, DATE_FORMAT(post_date, '%Y-%m-%d') AS post_date, image_url, caption, created_by, created_at, updated_at
         FROM daily_posts
         WHERE post_date = ?
         LIMIT 1`,
        [date]
      );
      return res.status(200).json({
        success: true,
        post: rows[0] || null,
        exists: rows.length > 0,
      });
    }

    const [rows] = await pool.query(
      `SELECT id, DATE_FORMAT(post_date, '%Y-%m-%d') AS post_date, image_url, caption, created_by, created_at, updated_at
       FROM daily_posts
       ORDER BY post_date DESC
       LIMIT ?`,
      [parseInt(limit, 10) || 50]
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      posts: rows,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. POST /api/v1/daily-posts
 * Admin upload endpoint:
 * Enforces rule: Exactly one picture per day allowed.
 * If a picture exists for the specified date, it updates/replaces it.
 */
async function uploadDailyPost(req, res, next) {
  try {
    const file = req.file || (req.files && req.files[0]);
    let imageUrl = req.body.image_url;

    if (file) {
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      imageUrl = `${baseUrl}/uploads/posts/${file.filename}`;
    }

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'No image uploaded. Please provide a picture for the daily post.',
      });
    }

    // Determine post_date (YYYY-MM-DD)
    let postDate = req.body.post_date;
    if (!postDate || !/^\d{4}-\d{2}-\d{2}$/.test(postDate)) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      postDate = `${yyyy}-${mm}-${dd}`;
    }

    const caption = req.body.caption || null;
    const staffId = req.staff?.id || null;

    // Check if post already exists for this date to determine insert vs replace
    const [existing] = await pool.query(
      'SELECT id, image_url FROM daily_posts WHERE post_date = ?',
      [postDate]
    );

    const isReplacement = existing.length > 0;

    // Insert or update (Strictly 1 pic per day)
    await pool.query(
      `INSERT INTO daily_posts (post_date, image_url, caption, created_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         image_url = VALUES(image_url),
         caption = VALUES(caption),
         updated_at = CURRENT_TIMESTAMP`,
      [postDate, imageUrl, caption, staffId]
    );

    const [updatedRow] = await pool.query(
      `SELECT id, DATE_FORMAT(post_date, '%Y-%m-%d') AS post_date, image_url, caption, created_by, created_at, updated_at
       FROM daily_posts
       WHERE post_date = ?`,
      [postDate]
    );

    return res.status(200).json({
      success: true,
      message: isReplacement
        ? `Post for ${postDate} successfully updated (replaced previous image)`
        : `Daily post for ${postDate} uploaded successfully`,
      post: updatedRow[0],
      isReplacement,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. DELETE /api/v1/daily-posts/:id
 * Admin delete endpoint
 */
async function deleteDailyPost(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM daily_posts WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Daily post not found',
      });
    }

    await pool.query('DELETE FROM daily_posts WHERE id = ?', [id]);

    return res.status(200).json({
      success: true,
      message: 'Daily post deleted successfully',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getRecentDailyPosts,
  getAllDailyPosts,
  uploadDailyPost,
  deleteDailyPost,
};
