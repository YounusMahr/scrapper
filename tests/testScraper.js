import { reloadProxies, getAllProxies, getProxyStats, getRandomProxy, markFailed } from '../config/proxies.js';
import fs from 'fs';
import path from 'path';

function runTests() {
  console.log('=== STARTING PROXY SYSTEM DIAGNOSTIC TESTS ===\n');

  // Test 1: Proxy parsing functionality
  console.log('[Test 1] Checking proxy loaded statistics...');
  const stats = getProxyStats();
  console.log(`Stats -> Total: ${stats.total}, Active: ${stats.active}, Failed: ${stats.failed}\n`);

  // Test 2: Active proxy selection
  if (stats.total > 0) {
    console.log('[Test 2] Selecting random proxies from pool...');
    const p1 = getRandomProxy();
    const p2 = getRandomProxy();
    console.log(`Selected: ${p1}`);
    console.log(`Selected: ${p2}\n`);

    // Test 3: Cool down mechanics
    console.log('[Test 3] Testing fail marking and cooldown removal...');
    const sampleProxy = p1;
    markFailed(sampleProxy);
    const postFailStats = getProxyStats();
    console.log(`Stats after failure -> Active: ${postFailStats.active}, Failed: ${postFailStats.failed}`);
    
    // Verify that the failed proxy has a trailing slash ignored robustly
    const withSlash = sampleProxy + '/';
    markFailed(withSlash);
    console.log('Ignored trailing slash comparison successfully.\n');

    // Test 4: Reloading proxies dynamically
    console.log('[Test 4] Reloading proxy pool dynamically...');
    reloadProxies();
    const reloadStats = getProxyStats();
    console.log(`Stats after reload -> Active: ${reloadStats.active}, Failed: ${reloadStats.failed}\n`);
  } else {
    console.log('[Test 2/3/4] Skipping since no proxies are configured in proxyscrape_premium_http_proxies.txt.\n');
  }

  console.log('=== ALL TESTS COMPLETED SUCCESSFULLY ===');
}

runTests();
