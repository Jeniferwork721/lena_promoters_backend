require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const routes = require('./src/routes');
const errorHandler = require('./src/middlewares/errorHandler');
const { initializeDatabase } = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded media statically (Receipts, Property Photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API routes under /api/v1
app.use('/api/v1', routes);

// Root Welcome Route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    project: 'Lena Promoters Mobile App Backend',
    version: '1.0.0',
    documentation: '/api/v1/health',
    endpoints: {
      auth: '/api/v1/auth',
      properties: '/api/v1/properties',
      coupons: '/api/v1/coupons',
      siteVisits: '/api/v1/site-visits',
      uploads: '/api/v1/uploads',
    },
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.originalUrl} not found on this server.`,
  });
});

// Global Error Handler
app.use(errorHandler);

// Start Server and Initialize Database
app.listen(PORT, async () => {
  console.log(`🚀 Lena Promoters Backend running on http://localhost:${PORT}`);
  console.log(`📡 Base API URL: http://localhost:${PORT}/api/v1`);
  
  // Initialize Database Tables and Seeds
  await initializeDatabase();
});
