import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// In-memory store for active sessions
// Key: sessionToken, Value: { email, name, picture, createdAt }
const sessionsStore = new Map();

/**
 * Verifies the Google ID token and creates an in-memory session.
 */
export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google ID token (credential) is required.' });
    }

    // Verify token with Google's OAuth client
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      console.error(`[Auth] Token verification failed: ${err.message}`);
      return res.status(401).json({ error: 'Invalid Google ID token.' });
    }

    if (!payload) {
      return res.status(401).json({ error: 'Google login failed — empty payload.' });
    }

    const { email, name, picture, email_verified } = payload;

    if (!email_verified) {
      return res.status(401).json({ error: 'Google email address is not verified.' });
    }

    // Create session token
    const sessionToken = crypto.randomUUID();
    
    // Store user session in-memory
    const sessionData = {
      email,
      name,
      picture,
      createdAt: new Date()
    };
    sessionsStore.set(sessionToken, sessionData);

    console.log(`[Auth] User ${name} (${email}) logged in successfully.`);

    return res.status(200).json({
      token: sessionToken,
      user: {
        email,
        name,
        picture
      }
    });
  } catch (error) {
    console.error(`[Auth] Google login error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Middleware to enforce authentication on protected endpoints.
 */
export const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. Authorization token missing.' });
    }

    const token = authHeader.split(' ')[1];
    const session = sessionsStore.get(token);

    if (!session) {
      return res.status(401).json({ error: 'Access denied. Session expired or invalid.' });
    }

    // Attach user session details to request object
    req.user = session;
    next();
  } catch (error) {
    console.error(`[Auth Middleware] Error: ${error.message}`);
    return res.status(401).json({ error: 'Authentication failed.' });
  }
};
