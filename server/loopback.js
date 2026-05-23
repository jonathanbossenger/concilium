const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function normalizeHostHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const host = typeof raw === 'string' ? raw.split(',')[0].trim().toLowerCase() : '';
  if (!host) return '';
  if (host.startsWith('[')) {
    const closingIndex = host.indexOf(']');
    return closingIndex === -1 ? host.slice(1) : host.slice(1, closingIndex);
  }
  const firstColonIndex = host.indexOf(':');
  const lastColonIndex = host.lastIndexOf(':');
  if (firstColonIndex !== -1 && firstColonIndex === lastColonIndex) {
    return host.slice(0, firstColonIndex);
  }
  return host;
}

function isLoopbackRequest(req) {
  const forwardedHost = normalizeHostHeader(req.headers['x-forwarded-host']);
  if (forwardedHost) return LOOPBACK_HOSTS.has(forwardedHost);
  const host = normalizeHostHeader(req.headers.host || req.hostname);
  return LOOPBACK_HOSTS.has(host);
}

function requireLoopbackRequest(req, res, next) {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: 'forbidden', code: 'loopback_only' });
  }
  next();
}

module.exports = {
  isLoopbackRequest,
  requireLoopbackRequest,
};
