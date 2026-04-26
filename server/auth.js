const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { getConfig, saveConfig } = require('./config');

const router = express.Router();

// ---------------------------------------------------------------------------
// Cookie helpers (no cookie-parser dependency)
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// Password hashing with Node.js built-in scrypt
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  try {
    const attempt = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    if (attempt.length !== expected.length) return false;
    return crypto.timingSafeEqual(attempt, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

const sessions = new Map(); // token -> { expires: number }

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expires <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

// Periodic cleanup of expired sessions (every hour).
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires <= now) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function isSetupNeeded() {
  const cfg = getConfig();
  return !cfg.auth || !cfg.auth.passwordHash;
}

/**
 * requireAuth — placed before all protected routes.
 * Allows through: /auth/*, /login, /setup
 * Redirects unauthenticated page requests to /login (or /setup if unconfigured).
 * Returns 401 JSON for unauthenticated API requests.
 */
function requireAuth(req, res, next) {
  // Paths that are always public.
  if (
    req.path === '/login' ||
    req.path === '/setup' ||
    req.path.startsWith('/auth/')
  ) {
    return next();
  }

  if (isSetupNeeded()) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Setup required', setupRequired: true });
    }
    return res.redirect('/setup');
  }

  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];

  if (validateSession(token)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login');
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

/** GET /auth/status — lets the login/setup pages know what state we're in. */
router.get('/status', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  res.json({
    setupRequired: isSetupNeeded(),
    authenticated: !isSetupNeeded() && validateSession(token),
  });
});

/** POST /auth/setup — first-run: create credentials (only when unconfigured). */
router.post('/setup', (req, res) => {
  if (!isSetupNeeded()) {
    return res.status(409).json({ error: 'Already configured' });
  }

  const { username, password, bind } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const cfg = getConfig();
  cfg.auth = {
    username: username.trim(),
    passwordHash: hashPassword(password),
  };
  if (bind && typeof bind === 'string' && bind.trim()) {
    cfg.bind = bind.trim();
  }
  saveConfig(cfg);

  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

/** POST /auth/login — exchange credentials for a session cookie. */
router.post('/login', (req, res) => {
  if (isSetupNeeded()) {
    return res.status(409).json({ error: 'Setup required', setupRequired: true });
  }

  const { username, password } = req.body || {};
  const cfg = getConfig();

  const usernameMatch =
    cfg.auth.username === (username || '').trim();
  const passwordMatch = verifyPassword(password || '', cfg.auth.passwordHash);

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

/** POST /auth/logout — destroy the current session. */
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (token) destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
