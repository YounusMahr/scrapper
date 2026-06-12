import express from 'express';
import { googleLogin } from '../controllers/authController.js';

const router = express.Router();

router.post('/login', googleLogin);

export default router;
