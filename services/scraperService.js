import { PlaywrightCrawler, Configuration } from 'crawlee';
import crypto from 'crypto';
import { getNextProxy, hasProxies } from '../config/proxies.js';
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

async function findBusinessWebsites(page, businessType, location, limit = 8) {
  const query = `${businessType} ${location} contact email`;
  console.log(`[Search] Searching: "${query}"`);

  // Try DuckDuckGo first
  try {
    await page.goto(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    const bodyText = await page.innerText('body').catch(() => '');
    const blocked = bodyText.includes('confirm this search') || bodyText.includes('bots use DuckDuckGo');

    if (!blocked) {
      const links = await page.$$eval('.result__url', els => els.map(el => el.textContent.trim()));
      const urls = links
        .map(url => {
          let u = url.startsWith('http') ? url : 'https://' + url;
          try { return new URL(u).origin; } catch { return null; }
        })
        .filter(u => u && !SKIP_DOMAINS.some(d => u.includes(d)));
      const unique = [...new Set(urls)].slice(0, limit);
      if (unique.length > 0) {
        console.log(`[Search] DuckDuckGo found ${unique.length} sites for "${query}"`);
        return unique;
      }
    }
    if (blocked) console.warn(`[Search] DuckDuckGo CAPTCHA for "${query}" — trying Google...`);
  } catch (e) {
    console.warn(`[Search] DuckDuckGo error: ${e.message}`);
  }

  // Fallback to Google
  try {
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );
    const links = await page.$$eval('a[href]', els =>
      els.map(el => el.href).filter(h => h.startsWith('http') && !h.includes('google.com'))
    );
    const urls = links
      .map(href => { try { return new URL(href).origin; } catch { return null; } })
      .filter(u => u && !SKIP_DOMAINS.some(d => u.includes(d)));
    const unique = [...new Set(urls)].slice(0, limit);
    console.log(`[Search] Google found ${unique.length} sites for "${query}"`);
    return unique;
  } catch (e) {
    console.error(`[Search] Google also failed: ${e.message}`);
    return [];
  }
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────

export async function runScraper({ jobId, query, webhookUrl }) {
  console.log(`[Scraper] Starting job: ${jobId}`);

  const crawleeConfig = new Configuration({ storageDir: `./storage/job-${jobId}` });
  const { business = [], location = [], job_title = [], targetUrls = [] } = query;

  // Step 1: Collect all website URLs to crawl
  const allTargetUrls = [...targetUrls];

  if (allTargetUrls.length === 0 && (business.length > 0 || location.length > 0)) {
    console.log(`[Scraper] Discovering business websites across all query combinations...`);

    const searchProxy = getNextProxy();
    const searchCrawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: (business.length * Math.max(location.length, 1)) + 5,
      requestHandlerTimeoutSecs: 30,
      maxRequestRetries: 1,
      headless: true,
      ...(searchProxy && { proxyConfiguration: { newUrlFunction: async () => searchProxy } }),
      launchContext: {
        launchOptions: { args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] }
      },
      requestHandler: async ({ page, request }) => {
        const { biz, loc } = request.userData;
        const sites = await findBusinessWebsites(page, biz, loc, 8);
        for (const site of sites) {
          if (!allTargetUrls.includes(site)) allTargetUrls.push(site);
        }
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
    requestHandlerTimeoutSecs: 25,
    maxRequestRetries: 1,
    headless: true,
    ...(hasProxies() && { proxyConfiguration: { newUrlFunction: async () => getNextProxy() } }),
    launchContext: {
      launchOptions: {
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-geolocation']
      }
    },

    requestHandler: async ({ request, page, enqueueLinks, log }) => {
      const currentUrl = new URL(request.url);
      const domain = currentUrl.origin;
      const domainKey = domain.toLowerCase();
      const primaryDomain = request.userData.primaryDomain || domainKey;

      log.info(`Crawling: ${request.url}`);

      await page.setViewportSize({
        width: 1280 + Math.floor(Math.random() * 200),
        height: 800 + Math.floor(Math.random() * 100)
      });

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 12000 });
      } catch { /* continue */ }

      const bodyText = await page.innerText('body').catch(() => '');
      const htmlContent = await page.content().catch(() => '');
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
      const isHomepage = request.url === domain || request.url === domain + '/';
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
        leadsByDomain[primaryDomain] = {
          personId: crypto.randomUUID(),
          organizationName: companyName,
          organizationWebsite: domain,
          organizationLinkedinUrl: null,
          email: null,
          phone: null,
          city: location[0] || null,
          state: location[0] || null,
          country: null,
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

    failedRequestHandler: async ({ request, log, error }) => {
      log.error(`Failed: ${request.url} — ${error.message}`);
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
}
