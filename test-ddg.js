import { PlaywrightCrawler } from 'crawlee';

async function main() {
  const query = 'site:linkedin.com/in/ owner hvac austin';
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    headless: true,
    requestHandler: async ({ request, page, log }) => {
      log.info(`Scraping search page: ${request.url}`);
      
      const body = await page.innerText('body');
      log.info(`Body length: ${body.length}`);
      log.info(`Body snippet: ${body.substring(0, 1000)}`);
      
      const results = await page.$$eval('.result__body', els => els.length);
      log.info(`Number of .result__body: ${results}`);
      
      const titles = await page.$$eval('.result__title', els => els.map(el => el.innerText.trim()));
      log.info(`Result titles: ${JSON.stringify(titles, null, 2)}`);
    }
  });

  await crawler.run([url]);
}

main();
