import dotenv from 'dotenv';
dotenv.config();

/**
 * Parses the PROXY_LIST environment variable into an array of proxy URLs.
 * Format: comma-separated proxy URLs.
 * Example: http://user:pass@host1:port,http://user:pass@host2:port
 */
function loadProxies() {
  const raw = process.env.PROXY_LIST || '';
  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map(p => p.trim())
    .filter(p => p.startsWith('http://') || p.startsWith('https://') || p.startsWith('socks5://'));
}

const proxies = loadProxies();
let currentIndex = 0;

/**
 * Returns the next proxy in round-robin order, or null if no proxies configured.
 */
export function getNextProxy() {
  if (proxies.length === 0) return null;
  const proxy = proxies[currentIndex % proxies.length];
  currentIndex++;
  return proxy;
}

/**
 * Returns all configured proxies.
 */
export function getAllProxies() {
  return proxies;
}

/**
 * Returns true if any proxies are configured.
 */
export function hasProxies() {
  return proxies.length > 0;
}

console.log(`[Proxy] ${proxies.length > 0 ? `${proxies.length} proxies loaded for rotation.` : 'No proxies configured — running without proxy.'}`);
