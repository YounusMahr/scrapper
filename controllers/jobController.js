import crypto from 'crypto';
import { runScraper } from '../services/scraperService.js';
import { getProxyStats } from '../config/proxies.js';

// In-memory store for tracking jobs and their results
const jobsStore = new Map();

/**
 * Helper to parse filters from an Apollo search URL.
 */
export const parseApolloUrl = (urlStr) => {
  const result = {
    location: [],
    business: [],
    job_title: []
  };

  if (!urlStr) return result;

  try {
    const hashPart = urlStr.split('#')[1] || '';
    const queryPart = hashPart.includes('?') ? hashPart.split('?')[1] : hashPart;
    const urlParams = new URLSearchParams(queryPart);

    for (const [key, val] of urlParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith('persontitles')) {
        result.job_title.push(val);
      } else if (normalizedKey.startsWith('personlocations')) {
        result.location.push(val);
      } else if (
        normalizedKey.startsWith('qorganizationkeywordtags') || 
        normalizedKey.startsWith('qorganizationname') ||
        normalizedKey.startsWith('organizationkeyword')
      ) {
        result.business.push(val);
      }
    }

    if (result.location.length === 0 && result.business.length === 0 && result.job_title.length === 0) {
      const parsedUrl = new URL(urlStr);
      for (const [key, val] of parsedUrl.searchParams.entries()) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.startsWith('persontitles')) {
          result.job_title.push(val);
        } else if (normalizedKey.startsWith('personlocations')) {
          result.location.push(val);
        } else if (
          normalizedKey.startsWith('qorganizationkeywordtags') || 
          normalizedKey.startsWith('qorganizationname') ||
          normalizedKey.startsWith('organizationkeyword')
        ) {
          result.business.push(val);
        }
      }
    }
  } catch (error) {
    console.error(`[Apollo Parser] Error parsing URL: ${error.message}`);
  }

  result.location = [...new Set(result.location)].filter(Boolean);
  result.business = [...new Set(result.business)].filter(Boolean);
  result.job_title = [...new Set(result.job_title)].filter(Boolean);

  return result;
};

/**
 * Creates and starts a new scraping job.
 */
export const createJob = async (req, res) => {
  try {
    const { url, location, business, job_title, targetUrls, webhookUrl } = req.body;

    let parsedFilters = { location: [], business: [], job_title: [] };
    if (url) {
      try { new URL(url); } catch {
        return res.status(400).json({ error: '"url" must be a valid URL.' });
      }
      parsedFilters = parseApolloUrl(url);
      console.log('[Controller] Parsed filters from Apollo URL:', parsedFilters);
    }

    // Merge manual filters with URL parsed filters
    const finalLocation = [...new Set([...(location || []), ...parsedFilters.location])];
    const finalBusiness = [...new Set([...(business || []), ...parsedFilters.business])];
    const finalJobTitle = [...new Set([...(job_title || []), ...parsedFilters.job_title])];
    const finalTargetUrls = targetUrls || [];

    // Validate inputs
    const hasUrls = Array.isArray(finalTargetUrls) && finalTargetUrls.length > 0;
    const hasQuery = finalLocation.length > 0 || finalBusiness.length > 0;

    if (!hasUrls && !hasQuery) {
      return res.status(400).json({
        error: 'Please provide either a valid Apollo "url", manual "targetUrls", or "business"/"location" query arrays.'
      });
    }

    if (webhookUrl) {
      try { new URL(webhookUrl); } catch {
        return res.status(400).json({ error: '"webhookUrl" must be a valid URL.' });
      }
    }

    // Generate unique job ID
    const jobId = crypto.randomUUID();

    // Save initial state in the in-memory job store
    const jobData = {
      jobId,
      status: 'processing',
      query: {
        location: finalLocation,
        business: finalBusiness,
        job_title: finalJobTitle,
        targetUrls: finalTargetUrls
      },
      leads: [],
      error: null,
      createdAt: new Date(),
      completedAt: null
    };
    jobsStore.set(jobId, jobData);

    // Trigger scraper in background
    setImmediate(async () => {
      try {
        const leads = await runScraper({
          jobId,
          query: {
            location: finalLocation,
            business: finalBusiness,
            job_title: finalJobTitle,
            targetUrls: finalTargetUrls
          },
          webhookUrl
        });

        // Update jobsStore with results
        const job = jobsStore.get(jobId);
        if (job) {
          job.status = 'completed';
          job.leads = leads || [];
          job.completedAt = new Date();
          jobsStore.set(jobId, job);
        }
      } catch (error) {
        console.error(`[Controller] Background scraper execution error: ${error.message}`);
        const job = jobsStore.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          jobsStore.set(jobId, job);
        }
      }
    });

    return res.status(202).json({
      jobId,
      status: 'processing',
      message: 'Scraper started successfully. Leads will be available via status endpoint or posted to the webhookUrl.'
    });
  } catch (error) {
    console.error(`[Controller] Create job error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Retrieves the status and results of a scraper job.
 */
export const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobsStore.get(jobId);

    if (!job) {
      return res.status(404).json({ error: `Job with ID ${jobId} not found.` });
    }

    return res.status(200).json(job);
  } catch (error) {
    console.error(`[Controller] Get job status error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Exposes live proxy and job statistics for the dashboard.
 */
export const getSystemStats = async (req, res) => {
  try {
    const proxyStats = getProxyStats();
    let processingJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;

    for (const job of jobsStore.values()) {
      if (job.status === 'processing') processingJobs++;
      else if (job.status === 'completed') completedJobs++;
      else if (job.status === 'failed') failedJobs++;
    }

    return res.status(200).json({
      proxies: proxyStats,
      jobs: {
        total: jobsStore.size,
        processing: processingJobs,
        completed: completedJobs,
        failed: failedJobs
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
