import express from 'express';
import { createJob, getJobStatus, getSystemStats } from '../controllers/jobController.js';
import { requireAuth } from '../controllers/authController.js';

const router = express.Router();

// Enforce authentication for all job & statistics endpoints
router.use(requireAuth);

router.post('/jobs', createJob);
router.get('/jobs/:jobId', getJobStatus);
router.get('/stats', getSystemStats);

export default router;
