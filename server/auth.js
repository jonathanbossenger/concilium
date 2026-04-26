const crypto = require('crypto');
const net = require('net');
const express = require('express');
const { getConfig, saveConfig } = require('./config');
const store = require('./store');

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

function isRequestSecure(req) {
  // req.secure is true for direct TLS. x-forwarded-proto is set by reverse
  // proxies; trust proxy must be enabled in Express for req.secure to reflect it.
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(res, token, req) {
  const securePart = isRequestSecure(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${securePart}`,
  );
}

function clearSessionCookie(res, req) {
  const securePart = isRequestSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${securePart}`);
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
// Session store (SQLite-backed, survives restarts)
// ---------------------------------------------------------------------------

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  store.createSession(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const session = store.getSession(token);
  if (!session) return false;
  if (session.expires <= Date.now()) {
    store.deleteSession(token);
    return false;
  }
  return true;
}

function refreshSession(token) {
  store.refreshSession(token, Date.now() + SESSION_TTL_MS);
}

function destroySession(token) {
  store.deleteSession(token);
}

// Periodic cleanup of expired sessions (every hour).
setInterval(() => {
  store.deleteExpiredSessions();
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Bind address validation
// ---------------------------------------------------------------------------

/**
 * Returns true when addr is a valid IP address (v4 or v6) or 'localhost'.
 * Rejects hostnames to prevent accidental misconfiguration.
 */
function isValidBind(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const trimmed = addr.trim();
  if (trimmed === 'localhost') return true;
  return net.isIP(trimmed) !== 0;
}

// ---------------------------------------------------------------------------
// Per-IP login rate limiter
// ---------------------------------------------------------------------------

// tracks { attempts: number, lockedUntil: number } per IP string
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
// Progressive lockout durations (ms): 15s, 30s, 60s, 120s, 300s, 900s max.
const LOCKOUT_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 900_000];

function lockoutDuration(attempts) {
  const idx = Math.min(attempts - MAX_ATTEMPTS, LOCKOUT_MS.length - 1);
  return LOCKOUT_MS[Math.max(0, idx)];
}

/** Returns seconds until unlock, or null when the IP is not locked out. */
function checkRateLimit(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || entry.lockedUntil <= Date.now()) return null;
  return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
}

function recordFailedLogin(ip) {
  const entry = loginAttempts.get(ip) || { attempts: 0, lockedUntil: 0 };
  entry.attempts += 1;
  // Lock on the MAX_ATTEMPTS-th failure so the very next attempt gets a 429.
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + lockoutDuration(entry.attempts);
  }
  loginAttempts.set(ip, entry);
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// Periodic cleanup of stale rate-limit entries (every 10 minutes).
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (entry.lockedUntil < now && entry.attempts <= MAX_ATTEMPTS) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function isSetupNeeded() {
  const cfg = getConfig();
  return !cfg.auth || !cfg.auth.passwordHash;
}

// All /auth/* routes set Cache-Control: no-store so intermediaries never cache them.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/**
 * requireAuth — placed before all protected routes in index.js.
 *
 * The allowlist below (/login, /setup, /auth/*) is belt-and-suspenders: those
 * paths are mounted *before* this middleware in index.js so they never reach
 * requireAuth in practice. The check is kept here so that requireAuth stays
 * correct if the mount order ever changes.
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
    // Sliding expiry: extend the session TTL and refresh the cookie on each
    // authenticated request so active users are not silently logged out.
    refreshSession(token);
    setSessionCookie(res, token, req);
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

  // Validate bind BEFORE modifying cfg to avoid dirtying the in-memory cache
  // on a 400 response.
  const trimmedBind = bind && typeof bind === 'string' ? bind.trim() : '';
  if (trimmedBind && !isValidBind(trimmedBind)) {
    return res.status(400).json({ error: 'bind must be a valid IP address or "localhost"' });
  }

  const cfg = getConfig();
  cfg.auth = {
    username: username.trim(),
    passwordHash: hashPassword(password),
  };
  if (trimmedBind) cfg.bind = trimmedBind;
  saveConfig(cfg);

  const token = createSession();
  setSessionCookie(res, token, req);
  res.json({ ok: true });
});

/** POST /auth/login — exchange credentials for a session cookie. */
router.post('/login', (req, res) => {
  if (isSetupNeeded()) {
    return res.status(409).json({ error: 'Setup required', setupRequired: true });
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  // Per-IP rate limiting: check before touching credentials.
  const retryAfter = checkRateLimit(ip);
  if (retryAfter !== null) {
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfter}s.` });
  }

  const { username, password } = req.body || {};
  const cfg = getConfig();

  // Always run verifyPassword regardless of username match to prevent timing
  // attacks that could distinguish "wrong username" from "wrong password".
  const passwordMatch = verifyPassword(password || '', cfg.auth.passwordHash);

  // Compare username using fixed-length buffers and timingSafeEqual so that
  // the username check does not leak whether an account exists via timing.
  const storedUser = cfg.auth.username || '';
  const inputUser = (username || '').trim();
  const uStored = Buffer.alloc(256);
  const uInput = Buffer.alloc(256);
  Buffer.from(storedUser).copy(uStored, 0, 0, Math.min(storedUser.length, 256));
  Buffer.from(inputUser).copy(uInput, 0, 0, Math.min(inputUser.length, 256));
  const usernameMatch = crypto.timingSafeEqual(uStored, uInput);

  if (!usernameMatch || !passwordMatch) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  resetLoginAttempts(ip);
  const token = createSession();
  setSessionCookie(res, token, req);
  res.json({ ok: true });
});

/** POST /auth/logout — destroy the current session. */
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (token) destroySession(token);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, isValidBind };
