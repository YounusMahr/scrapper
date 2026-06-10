import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import jobRoutes from './routes/jobRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Mount API Routes
app.use('/api', jobRoutes);

// Server status and diagnostics
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error(`[Server Error] ${err.message}`);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`Lead Scraper Platform running on http://localhost:${PORT}`);
});
