import express from 'express';
import { runScraper } from './services/scraperService.js';
import { parseApolloUrl } from './controllers/jobController.js';

async function test() {
  console.log('=== STARTING IN-MEMORY DIAGNOSTIC TEST ===');

  const apolloUrl = 'https://app.apollo.io/#/people?sortByField=recommendations_score&sortAscending=false&page=1&personTitles[]=owner&personLocations[]=austin&qOrganizationKeywordTags[]=hvac';
  console.log(`[Test] Sample Apollo URL: ${apolloUrl}`);
  
  const parsedFilters = parseApolloUrl(apolloUrl);
  console.log('[Test] Parsed Filters:', JSON.stringify(parsedFilters, null, 2));

  // 1. Spin up a local webhook receiver to capture results
  const receiverApp = express();
  receiverApp.use(express.json());

  let testServer;
  
  const webhookPromise = new Promise((resolve) => {
    receiverApp.post('/callback', (req, res) => {
      res.sendStatus(200);
      resolve(req.body);
    });
  });

  testServer = receiverApp.listen(8999, () => {
    console.log('[Test] Local webhook listener started on http://localhost:8999/callback');
  });

  // 2. Run the scraper in-memory
  const jobId = 'test-job-id-' + Math.floor(Math.random() * 1000);
  try {
    console.log('[Test] Running in-memory scraper...');
    await runScraper({
      jobId,
      query: {
        location: parsedFilters.location,
        business: parsedFilters.business,
        job_title: parsedFilters.job_title,
        targetUrls: []
      },
      webhookUrl: 'http://localhost:8999/callback'
    });

    // 3. Wait for webhook callback to receive results
    console.log('[Test] Waiting for webhook payload delivery...');
    const payload = await webhookPromise;

    console.log('\n=== DIAGNOSTIC TEST RESULTS RECEIVED VIA WEBHOOK ===');
    console.log(`Status: ${payload.status}`);
    console.log(`Leads Count: ${payload.leads.length}`);
    if (payload.leads.length > 0) {
      console.log('First Lead Match:');
      console.log(JSON.stringify(payload.leads[0], null, 2));
    }
  } catch (error) {
    console.error('[Test] Run failed with exception:', error);
  } finally {
    if (testServer) {
      testServer.close();
    }
    process.exit(0);
  }
}

test();
