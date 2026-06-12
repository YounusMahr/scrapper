import { PlaywrightCrawler, Configuration, ProxyConfiguration } from 'crawlee';
import crypto from 'crypto';
import { getRandomProxy, getFreshProxy, markFailed, hasProxies, getProxyStats, reloadProxies } from '../config/proxies.js';
import { fireWebhook } from './webhookService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractEmails(text) {
  if (!text) return [];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}/g;
  const matches = text.match(emailRegex) || [];
  const falsePositives = [
    'sentry.io', 'github.com', 'example.com', 'w3.org',
    'bootstrap.com', 'jquery.com', 'schema.org', 'cloudflare.com',
    'google.com', 'facebook.com', 'wix.com', 'wordpress.org'
  ];
  return [...new Set(matches.map(e => e.toLowerCase()))].filter(e =>
    !falsePositives.some(d => e.includes(d)) &&
    !e.match(/\.(png|jpg|jpeg|gif|css|js|webp|svg)$/)
  );
}

function extractPhone(text) {
  if (!text) return null;
  const phoneRegex = /(\+?[\d\s\-().]{7,20})/g;
  const matches = text.match(phoneRegex) || [];
  for (const m of matches) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) return m.trim();
  }
  return null;
}

function parseLocationDetails(locationStr) {
  if (!locationStr) return { city: null, state: null, country: null };
  const parts = locationStr.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[2] };
  } else if (parts.length === 2) {
    return { city: parts[0], state: parts[1], country: null };
  }
  return { city: locationStr, state: null, country: null };
}

function extractSocials(hrefs) {
  const socials = { linkedin: null, twitter: null, facebook: null, instagram: null };
  for (const href of hrefs) {
    if (!href) continue;
    if (!socials.linkedin && (href.includes('linkedin.com/company/') || href.includes('linkedin.com/in/'))) {
      socials.linkedin = href;
    } else if (!socials.twitter && (href.includes('twitter.com/') || href.includes('x.com/'))) {
      socials.twitter = href;
    } else if (!socials.facebook && href.includes('facebook.com/')) {
      socials.facebook = href;
    } else if (!socials.instagram && href.includes('instagram.com/')) {
      socials.instagram = href;
    }
  }
  return socials;
}

const SKIP_DOMAINS = [
  'duckduckgo.com', 'wikipedia.org', 'linkedin.com', 'facebook.com',
  'twitter.com', 'instagram.com', 'yelp.com', 'yellowpages.com',
  'zoominfo.com', 'crunchbase.com', 'apollo.io', 'mapquest.com',
  'github.com', 'google.com', 'glassdoor.com', 'indeed.com', 'bbb.org',
  'angi.com', 'thumbtack.com', 'homeadvisor.com', 'houzz.com',
  'nextdoor.com', 'trustpilot.com', 'sitejabber.com'
];

function isValidUrl(url) {
  try { new URL(url); return true; } catch { return false; }
}

// ─── Search Engine: Find Business Websites ───────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildSearchQueries(businessType, location) {
  const loc = location || '';
  const base = loc ? `${businessType} ${loc}` : businessType;
  return [
    `${base} contact us`,
    `${base} company`,
    `${base} email phone`
  ];
}

async function searchDuckDuckGo(page, query, limit) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

  const bodyText = await page.innerText('body').catch(() => '');
  const blocked = bodyText.includes('confirm this search') ||
                  bodyText.includes('bots use DuckDuckGo') ||
                  bodyText.includes('captcha') ||
                  bodyText.includes('Rate limit');

  if (blocked) {
    console.warn(`[Search] DuckDuckGo blocked for "${query}"`);
    return [];
  }

  // Try multiple selectors for URL extraction
  let urls = [];

  // Method 1: .result__a (the actual link)
  const resultLinks = await page.$$eval('.result__a', els =>
    els.map(el => el.href).filter(h => h && h.startsWith('http'))
  ).catch(() => []);

  if (resultLinks.length > 0) {
    urls = resultLinks;
  }

  // Method 2: .result__url (display URL text)
  if (urls.length === 0) {
    const displayUrls = await page.$$eval('.result__url', els =>
      els.map(el => el.textContent.trim())
    ).catch(() => []);

    urls = displayUrls
      .map(u => {
        const fixed = u.startsWith('http') ? u : 'https://' + u;
        try { return new URL(fixed).href; } catch { return null; }
      })
      .filter(Boolean);
  }

  // Method 3: all links in result bodies
  if (urls.length === 0) {
    urls = await page.$$eval('.result__body a[href]', els =>
      els.map(el => el.href).filter(h => h.startsWith('http') && !h.includes('duckduckgo.com'))
    ).catch(() => []);
  }

  const origins = urls
    .map(href => {
      try { return new URL(href).origin; } catch { return null; }
    })
    .filter(u => u && !SKIP_DOMAINS.some(d => u.includes(d)));

  return [...new Set(origins)].slice(0, limit);
}

async function searchGoogle(page, query, limit) {
  await page.goto(
    `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    { waitUntil: 'domcontentloaded', timeout: 25000 }
  );

  const bodyText = await page.innerText('body').catch(() => '');
  if (bodyText.includes('unusual traffic') || bodyText.includes('captcha')) {
    console.warn(`[Search] Google blocked for "${query}"`);
    return [];
  }

  const links = await page.$$eval('#search a[href]', els =>
    els.map(el => el.href).filter(h => h.startsWith('http') && !h.includes('google.com'))
  ).catch(() => []);

  const origins = links
    .map(href => { try { return new URL(href).origin; } catch { return null; } })
    .filter(u => u && !SKIP_DOMAINS.some(d => u.includes(d)));

  return [...new Set(origins)].slice(0, limit);
}

async function searchBing(page, query, limit) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

  const bodyText = await page.innerText('body').catch(() => '');
  if (bodyText.includes('unusual traffic') || bodyText.includes('captcha') || bodyText.includes('blocked')) {
    console.warn(`[Search] Bing blocked for "${query}"`);
    return [];
  }

  const links = await page.$$eval('#b_results li.b_algo h2 a', els =>
    els.map(el => el.href).filter(h => h && h.startsWith('http'))
  ).catch(() => []);

  const origins = links
    .map(href => { try { return new URL(href).origin; } catch { return null; } })
    .filter(u => u && !SKIP_DOMAINS.some(d => u.includes(d)));

  return [...new Set(origins)].slice(0, limit);
}

async function findBusinessWebsites(page, businessType, location, limit = 8) {
  const queries = buildSearchQueries(businessType, location);
  const allFound = [];

  // Set a realistic user agent
  const ua = getRandomUA();
  await page.setExtraHTTPHeaders({ 'User-Agent': ua }).catch(() => {});

  for (const query of queries) {
    if (allFound.length >= limit) break;

    console.log(`[Search] Trying: "${query}"`);

    // Try DuckDuckGo first
    try {
      const ddgResults = await searchDuckDuckGo(page, query, limit - allFound.length);
      if (ddgResults.length > 0) {
        console.log(`[Search] DuckDuckGo found ${ddgResults.length} sites for "${query}"`);
        allFound.push(...ddgResults);
        break; // success, no need to try Google or other queries
      }
    } catch (e) {
      console.warn(`[Search] DuckDuckGo error: ${e.message}`);
    }

    // Fallback to Bing
    try {
      const bingResults = await searchBing(page, query, limit - allFound.length);
      if (bingResults.length > 0) {
        console.log(`[Search] Bing found ${bingResults.length} sites for "${query}"`);
        allFound.push(...bingResults);
        break;
      }
    } catch (e) {
      console.warn(`[Search] Bing error: ${e.message}`);
    }

    // Fallback to Google
    try {
      const googleResults = await searchGoogle(page, query, limit - allFound.length);
      if (googleResults.length > 0) {
        console.log(`[Search] Google found ${googleResults.length} sites for "${query}"`);
        allFound.push(...googleResults);
        break;
      }
    } catch (e) {
      console.warn(`[Search] Google error: ${e.message}`);
    }
  }

  const unique = [...new Set(allFound)].slice(0, limit);
  console.log(`[Search] Total unique sites found: ${unique.length} for "${businessType}" in "${location}"`);
  return unique;
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────

export async function runScraper({ jobId, query, webhookUrl }) {
  console.log(`[Scraper] Starting job: ${jobId}`);

  // Dynamically reload proxies from txt file or env at the start of each job
  reloadProxies();

  if (hasProxies()) {
    const stats = getProxyStats();
    console.log(`[Scraper] Proxy pool: ${stats.active} active / ${stats.total} total / ${stats.failed} failed`);
  } else {
    console.log(`[Scraper] No proxies configured — running direct.`);
  }

  const crawleeConfig = new Configuration({ storageDir: `./storage/job-${jobId}` });
  const { business = [], location = [], job_title = [], targetUrls = [] } = query;

  // Step 1: Collect all website URLs to crawl
  const allTargetUrls = [...targetUrls];

  if (allTargetUrls.length === 0 && (business.length > 0 || location.length > 0)) {
    console.log(`[Scraper] Discovering business websites across all query combinations...`);

    const searchCrawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: (business.length * Math.max(location.length, 1)) + 5,
      requestHandlerTimeoutSecs: 45,
      maxRequestRetries: 3,
      headless: true,
      ...(hasProxies() && {
        proxyConfiguration: new ProxyConfiguration({
          newUrlFunction: async () => getRandomProxy()
        })
      }),
      launchContext: {
        launchOptions: { args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] }
      },
      requestHandler: async ({ page, request, proxyInfo }) => {
        const { biz, loc } = request.userData;
        const currentProxy = proxyInfo?.url || 'direct';

        const sites = await findBusinessWebsites(page, biz, loc, 8);

        // If no sites found, the proxy may be blocked — mark it and retry
        if (sites.length === 0 && hasProxies()) {
          console.warn(`[Search] No results via proxy ${currentProxy} — marking as failed`);
          markFailed(currentProxy);
        }

        for (const site of sites) {
          if (!allTargetUrls.includes(site)) allTargetUrls.push(site);
        }
      },
      failedRequestHandler: async ({ request, log, error }) => {
        log.error(`Search failed: ${request.url} — ${error.message}`);
      }
    }, crawleeConfig);

    // Build one search request per business+location combination
    const searchRequests = [];
    const locs = location.length > 0 ? location : [''];
    for (const biz of business) {
      for (const loc of locs) {
        searchRequests.push({
          url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${biz} ${loc} contact email`)}`,
          userData: { biz, loc }
        });
      }
    }

    try {
      await searchCrawler.run(searchRequests);
    } catch (err) {
      console.error(`[Scraper] Search phase failed: ${err.message}`);
    }

    console.log(`[Scraper] Discovered ${allTargetUrls.length} unique websites to crawl.`);
  }

  const finalUrls = [...new Set(allTargetUrls)].filter(isValidUrl);

  if (finalUrls.length === 0) {
    console.warn(`[Scraper] No websites discovered. Sending empty leads.`);
    await fireWebhook(webhookUrl, { event: 'job.completed', jobId, status: 'completed', leads: [] });
    return;
  }

  // Step 2: Crawl each website for emails
  console.log(`[Scraper] Crawling ${finalUrls.length} websites for emails...`);

  // In-memory store keyed by domain
  const leadsByDomain = {};

  const crawlConfig = new Configuration({ storageDir: `./storage/job-${jobId}-crawl` });
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: finalUrls.length * 4,
    requestHandlerTimeoutSecs: 30,
    maxRequestRetries: 3,
    headless: true,
    ...(hasProxies() && {
      proxyConfiguration: new ProxyConfiguration({
        newUrlFunction: async () => getRandomProxy()
      })
    }),
    launchContext: {
      launchOptions: {
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-geolocation']
      }
    },

    requestHandler: async ({ request, page, enqueueLinks, log, proxyInfo }) => {
      const currentUrl = new URL(request.url);
      const domain = currentUrl.origin;
      const domainKey = domain.toLowerCase();
      const primaryDomain = request.userData.primaryDomain || domainKey;
      const currentProxy = proxyInfo?.url || 'direct';

      log.info(`Crawling: ${request.url} (proxy: ${currentProxy})`);

      await page.setViewportSize({
        width: 1280 + Math.floor(Math.random() * 200),
        height: 800 + Math.floor(Math.random() * 100)
      });

      await page.setExtraHTTPHeaders({
        'User-Agent': getRandomUA()
      }).catch(() => {});

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 12000 });
      } catch { /* continue */ }

      const bodyText = await page.innerText('body').catch(() => '');
      const htmlContent = await page.content().catch(() => '');

      // Detect CAPTCHA/block pages and mark proxy as failed
      const lowerBody = bodyText.toLowerCase();
      const captchaSignals = ['captcha', 'access denied', 'blocked', 'verify you are human',
        'unusual traffic', 'automated traffic', 'please confirm', 'security check'];
      if (captchaSignals.some(s => lowerBody.includes(s))) {
        log.warn(`CAPTCHA/block detected on ${request.url} — marking proxy as failed`);
        if (hasProxies()) markFailed(currentProxy);
      }

      const emails = extractEmails(bodyText + ' ' + htmlContent);
      const phone = extractPhone(bodyText);

      const linksInfo = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.innerText.trim() }))
      ).catch(() => []);

      const hrefs = linksInfo.map(l => l.href);
      const socials = extractSocials(hrefs);

      const pageTitle = await page.title().catch(() => '');
      const companyName = pageTitle.split('|')[0].split('-')[0].trim() || currentUrl.hostname;

      // Enqueue contact/about sub-pages from homepage only
      const normalizedUrl = request.url.replace(/\/$/, '');
      const normalizedDomain = domain.replace(/\/$/, '');
      const isHomepage = normalizedUrl === normalizedDomain;
      if (isHomepage) {
        const contactKeywords = ['contact', 'about', 'team', 'staff', 'info', 'reach'];
        const subLinks = linksInfo
          .filter(l => {
            if (!l.href || !l.href.startsWith(domain)) return false;
            const t = l.text.toLowerCase(), h = l.href.toLowerCase();
            return contactKeywords.some(k => t.includes(k) || h.includes(k));
          })
          .map(l => l.href);

        const uniqueSubs = [...new Set(subLinks)].slice(0, 3);
        if (uniqueSubs.length > 0) {
          await enqueueLinks({ urls: uniqueSubs, userData: { primaryDomain: domainKey } });
        }
      }

      // Merge data into the domain's lead entry
      if (!leadsByDomain[primaryDomain]) {
        const parsedLoc = parseLocationDetails(location[0]);
        leadsByDomain[primaryDomain] = {
          personId: crypto.randomUUID(),
          organizationName: companyName,
          organizationWebsite: domain,
          organizationLinkedinUrl: null,
          email: null,
          phone: null,
          city: parsedLoc.city,
          state: parsedLoc.state,
          country: parsedLoc.country,
          sourceUrl: request.url
        };
      }

      const lead = leadsByDomain[primaryDomain];

      // Update with any new email/phone/social found on this page
      if (!lead.email && emails.length > 0) lead.email = emails[0];
      if (!lead.phone && phone) lead.phone = phone;
      if (!lead.organizationLinkedinUrl && socials.linkedin) lead.organizationLinkedinUrl = socials.linkedin;
      if (emails.length > 0 || socials.linkedin) lead.sourceUrl = request.url;
    },

    failedRequestHandler: async ({ request, log, error, proxyInfo }) => {
      log.error(`Failed: ${request.url} — ${error.message}`);
      if (hasProxies() && proxyInfo?.url) {
        markFailed(proxyInfo.url);
      }
    }
  }, crawlConfig);

  try {
    await crawler.run(finalUrls);
  } catch (err) {
    console.error(`[Scraper] Crawl error: ${err.message}`);
  }

  // Step 3: Only keep leads that have an email
  const leads = Object.values(leadsByDomain).filter(l => l.email);

  console.log(`[Scraper] Job ${jobId} done. Found ${leads.length} leads with emails (from ${Object.keys(leadsByDomain).length} sites crawled).`);

  await fireWebhook(webhookUrl, {
    event: 'job.completed',
    jobId,
    status: 'completed',
    leads
  });

  return leads;
}
