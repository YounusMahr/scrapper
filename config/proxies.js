import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

/**
 * Premium proxy pool with CAPTCHA-aware rotation.
 *
 * - getRandomProxy()     → random active proxy
 * - getFreshProxy(exclude) → random proxy excluding the given one(s)
 * - markFailed(proxy)    → temporarily removes proxy from rotation
 * - getNextProxy()       → round-robin (kept for backwards compat)
 * - hasProxies()         → true if any proxies loaded
 */

function parseProxyLine(line) {
  const clean = line.trim();
  if (!clean) return null;

  // If it already has a protocol, use it
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('socks5://')) {
    return clean;
  }

  // Handle format user:pass@host:port
  if (clean.includes('@')) {
    return `http://${clean}`;
  }

  // Handle format user:pass:host:port (3 colons, 4 parts) or host:port:user:pass
  const parts = clean.split(':');
  if (parts.length === 4) {
    const part1IsPort = !isNaN(parts[1]) && Number(parts[1]) > 0 && Number(parts[1]) < 65536;
    const part3IsPort = !isNaN(parts[3]) && Number(parts[3]) > 0 && Number(parts[3]) < 65536;

    if (part3IsPort && !part1IsPort) {
      // Format: user:pass:host:port
      const [user, pass, host, port] = parts;
      return `http://${user}:${pass}@${host}:${port}`;
    } else if (part1IsPort && !part3IsPort) {
      // Format: host:port:user:pass
      const [host, port, user, pass] = parts;
      return `http://${user}:${pass}@${host}:${port}`;
    } else {
      // Fallback to user:pass:host:port
      const [user, pass, host, port] = parts;
      return `http://${user}:${pass}@${host}:${port}`;
    }
  }

  // Fallback
  return `http://${clean}`;
}

function loadProxies() {
  const proxies = [];

  // Try to load from proxyscrape_premium_http_proxies.txt in workspace root
  const txtFilePath = path.join(process.cwd(), 'proxyscrape_premium_http_proxies.txt');
  if (fs.existsSync(txtFilePath)) {
    try {
      const content = fs.readFileSync(txtFilePath, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const parsed = parseProxyLine(line);
        if (parsed) proxies.push(parsed);
      }
      if (proxies.length > 0) {
        console.log(`[Proxy] Loaded ${proxies.length} proxies from ${txtFilePath}`);
        return proxies;
      }
    } catch (err) {
      console.error(`[Proxy] Error reading proxyscrape_premium_http_proxies.txt: ${err.message}`);
    }
  }

  // Fallback to PROXY_LIST env variable
  const raw = process.env.PROXY_LIST || '';
  if (raw.trim()) {
    const parts = raw.split(',');
    for (const part of parts) {
      const parsed = parseProxyLine(part);
      if (parsed) proxies.push(parsed);
    }
  }

  return proxies;
}

const allProxies = loadProxies();

// Active set = proxies currently available for use
const activeProxies = [...allProxies];

// Map<proxy, timestamp> — when the proxy was marked as failed
const failedProxies = new Map();

// Cooldown: 2 minutes before a failed proxy is retried
const COOLDOWN_MS = 2 * 60 * 1000;

let roundRobinIndex = 0;

/**
 * Purge expired cooldowns — called before any proxy selection.
 */
function purgeExpiredFailures() {
  const now = Date.now();
  for (const [proxy, failedAt] of failedProxies) {
    if (now - failedAt >= COOLDOWN_MS) {
      failedProxies.delete(proxy);
      const cleanProxy = proxy.replace(/\/$/, '');
      const exists = activeProxies.some(p => p.replace(/\/$/, '') === cleanProxy);
      if (!exists) {
        activeProxies.push(proxy);
      }
    }
  }
}

/**
 * Returns a random proxy from the active pool.
 */
export function getRandomProxy() {
  purgeExpiredFailures();
  if (activeProxies.length === 0) {
    // All proxies are cooling down — force-reset the oldest failure
    const oldest = failedProxies.keys().next().value;
    if (oldest) {
      failedProxies.delete(oldest);
      activeProxies.push(oldest);
    }
  }
  if (activeProxies.length === 0) return null;
  return activeProxies[Math.floor(Math.random() * activeProxies.length)];
}

/**
 * Returns a random proxy excluding the one(s) that just failed.
 */
export function getFreshProxy(exclude = []) {
  purgeExpiredFailures();
  const excludeSet = new Set(
    (Array.isArray(exclude) ? exclude : [exclude]).map(p => p.replace(/\/$/, ''))
  );
  const candidates = activeProxies.filter(p => !excludeSet.has(p.replace(/\/$/, '')));

  if (candidates.length === 0) {
    // Force-reset all excluded proxies
    for (const p of excludeSet) {
      failedProxies.delete(p);
      const exists = activeProxies.some(ap => ap.replace(/\/$/, '') === p);
      if (!exists) {
        // Find the original proxy with trailing slashes restored if any
        const original = allProxies.find(orig => orig.replace(/\/$/, '') === p) || p;
        activeProxies.push(original);
      }
    }
    return getRandomProxy();
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Marks a proxy as failed — it will be excluded for COOLDOWN_MS.
 */
export function markFailed(proxy) {
  if (!proxy) return;
  const cleanProxy = proxy.replace(/\/$/, '');
  failedProxies.set(cleanProxy, Date.now());
  const idx = activeProxies.findIndex(p => p.replace(/\/$/, '') === cleanProxy);
  if (idx !== -1) {
    activeProxies.splice(idx, 1);
  }
  console.log(`[Proxy] Marked as failed (cooldown ${COOLDOWN_MS / 1000}s): ${cleanProxy}`);
}

/**
 * Round-robin proxy selection (backwards-compatible).
 */
export function getNextProxy() {
  purgeExpiredFailures();
  const pool = activeProxies.length > 0 ? activeProxies : allProxies;
  if (pool.length === 0) return null;
  const proxy = pool[roundRobinIndex % pool.length];
  roundRobinIndex++;
  return proxy;
}

/**
 * Returns all configured proxies (original list).
 */
export function getAllProxies() {
  return allProxies;
}

/**
 * Returns currently active (non-failed) proxies.
 */
export function getActiveProxies() {
  purgeExpiredFailures();
  return [...activeProxies];
}

/**
 * Returns true if any proxies are configured.
 */
export function hasProxies() {
  return allProxies.length > 0;
}

/**
 * Returns pool stats for logging.
 */
export function getProxyStats() {
  purgeExpiredFailures();
  return {
    total: allProxies.length,
    active: activeProxies.length,
    failed: failedProxies.size
  };
}

/**
 * Dynamically reloads proxies from file/environment.
 */
export function reloadProxies() {
  const newProxies = loadProxies();
  allProxies.length = 0;
  allProxies.push(...newProxies);
  activeProxies.length = 0;
  activeProxies.push(...allProxies);
  failedProxies.clear();
  roundRobinIndex = 0;
  console.log(`[Proxy] Reloaded proxy pool: ${allProxies.length} premium proxies loaded. Active: ${activeProxies.length}`);
}

console.log(`[Proxy] ${allProxies.length} premium proxies loaded. Active: ${activeProxies.length}`);

