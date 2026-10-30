/**
 * Centralized error handling middleware
 */
function errorHandler(err, req, res, next) {
  // Handle malformed JSON gracefully without logging full stack
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload format.',
    });
  }

  console.error('❌ Server Error:', err);

  if (err.name === 'MulterError' || (err.message && err.message.includes('Invalid file type'))) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum allowed size is 15 MB.',
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload error.',
    });
  }

  const statusCode = err.statusCode || (err.status || 500);
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error occurred.',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

module.exports = errorHandler;
