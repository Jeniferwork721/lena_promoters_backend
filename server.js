require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const routes = require('./src/routes');
const errorHandler = require('./src/middlewares/errorHandler');
const { initializeDatabase } = require('./src/config/db');
const { initGreetingsScheduler } = require('./src/services/greetings.service');

const app = express();
const PORT = process.env.PORT || 5000;

// Comprehensive CORS middleware
app.use(cors({
  origin: true, // Allow any calling origin (including https://crm.lenapromoterspvtltd.com, localhost)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
}));
app.options('*', cors());

// Explicit preflight and header guarantee
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded media statically (Receipts, Property Photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public Health Check Route
app.get('/health-check', (req, res) => {
  res.json({
    status: 'online',
    project: 'Lena Promoters Backend API',
    version: '1.0.0',
    documentation: '/api/v1/health',
  });
});

// Mount API routes under /api/v1 as well as root level for frontend compatibility
app.use('/api/v1', routes);
app.use('/', routes);

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

  // Initialize Daily Automated Greetings Scheduler (08:00 AM IST)
  initGreetingsScheduler();
});
