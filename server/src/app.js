import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import productionRoutes from './routes/production.js';
import layerRoutes from './routes/layers.js';
import avaRoutes from './routes/avas.js';
import climateRoutes from './routes/climate.js';
import vineyardRoutes from './routes/vineyards.js';
import wineryRoutes from './routes/wineries.js';
import { requireApiKey } from './middleware/apiKey.js';
import { pool } from './db/pool.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Trust Railway/Vercel reverse proxy so express-rate-limit can read X-Forwarded-For
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});

// Middleware
app.use(limiter);
// CORS_ORIGINS env var allows adding extra origins at runtime (comma-separated)
// e.g. "https://wv.terranthro.com,https://terranthro.com"
const extraOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

const PROD_ORIGINS = [
  'https://terranthro.com',
  'https://www.terranthro.com',
  ...extraOrigins,
];

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
];

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? PROD_ORIGINS : DEV_ORIGINS,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/production', productionRoutes);
app.use('/api/layers', layerRoutes);
app.use('/api/avas', avaRoutes);
app.use('/api/climate', climateRoutes);
app.use('/api/wineries', requireApiKey, wineryRoutes);
app.use('/api/vineyards', requireApiKey, vineyardRoutes);

// Health check — includes DB connectivity
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    // db not reachable
  }

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'OK' : 'DEGRADED',
    db: dbOk ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
    service: 'terranthro-api',
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

app.listen(PORT, () => {
  console.log(`🍷 Terranthro API Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
