// ==========================================================================
// Auth Guard Guard Check (Blocks rendering if session token is missing)
// ==========================================================================
const checkAuth = () => {
  const token = localStorage.getItem('scrapper_session_token');
  if (!token) {
    window.location.href = '/login.html';
  }
};
checkAuth();

const sessionToken = localStorage.getItem('scrapper_session_token');

// Global variables to track state
let currentJobId = null;
let pollingInterval = null;
let allLeads = [];
let activeMode = 'query'; // 'query' or 'urls'

// DOM Elements
const statProxies = document.getElementById('stat-proxies');
const statJobs = document.getElementById('stat-jobs');
const statFailed = document.getElementById('stat-failed');

const btnModeQuery = document.getElementById('btn-mode-query');
const btnModeUrls = document.getElementById('btn-mode-urls');
const searchFields = document.getElementById('mode-search-fields');
const urlsFields = document.getElementById('mode-urls-fields');

const scraperForm = document.getElementById('scraper-form');
const submitButton = document.getElementById('submit-button');
const btnText = submitButton.querySelector('.btn-text');
const btnLoader = submitButton.querySelector('.btn-loader');

const emptyState = document.getElementById('empty-state');
const statusCard = document.getElementById('status-card');
const statusBadge = document.getElementById('status-badge');
const displayJobId = document.getElementById('display-job-id');
const statusMessage = document.getElementById('status-message');
const statusDetail = document.getElementById('status-detail');

const resultsCard = document.getElementById('results-card');
const leadsTableBody = document.getElementById('leads-table-body');
const exportCsvBtn = document.getElementById('export-csv-btn');

/* ==========================================================================
   User Session & Profile Binding
   ========================================================================== */

const loadUserProfile = () => {
  const userJson = localStorage.getItem('scrapper_user');
  const userProfileWidget = document.getElementById('user-profile-widget');
  const userAvatarImg = document.getElementById('user-avatar-img');
  const userNameSpan = document.getElementById('user-name-span');

  if (userJson && userProfileWidget && userAvatarImg && userNameSpan) {
    try {
      const user = JSON.parse(userJson);
      userAvatarImg.src = user.picture || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
      userNameSpan.textContent = user.name || 'User';
      userProfileWidget.classList.remove('hidden');
    } catch (err) {
      console.error('Failed to parse user session info', err);
    }
  }
};
loadUserProfile();

// Sign Out handler
const handleSignOut = () => {
  localStorage.removeItem('scrapper_session_token');
  localStorage.removeItem('scrapper_user');
  window.location.href = '/login.html';
};

// Bind sign out button
const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
  logoutBtn.addEventListener('click', handleSignOut);
}

/* ==========================================================================
   Initialization & Stats Polling
   ========================================================================== */

async function fetchStats() {
  try {
    const response = await fetch('/api/stats', {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (response.status === 401) {
      handleSignOut();
      return;
    }

    if (!response.ok) throw new Error('Failed to fetch stats');
    const data = await response.json();
    
    // Update stats UI
    statProxies.textContent = data.proxies.active !== undefined ? `${data.proxies.active}/${data.proxies.total}` : '0/0';
    statJobs.textContent = data.jobs.total || '0';
    statFailed.textContent = data.proxies.failed || '0';
  } catch (err) {
    console.error('Error loading stats:', err);
    statProxies.textContent = 'Error';
    statJobs.textContent = 'Error';
    statFailed.textContent = 'Error';
  }
}

// Initial stats fetch and set interval
fetchStats();
const statsInterval = setInterval(fetchStats, 8000);

/* ==========================================================================
   Mode Switcher
   ========================================================================== */

btnModeQuery.addEventListener('click', () => {
  activeMode = 'query';
  btnModeQuery.classList.add('active');
  btnModeUrls.classList.remove('active');
  searchFields.classList.add('active');
  urlsFields.classList.remove('active');
});

btnModeUrls.addEventListener('click', () => {
  activeMode = 'urls';
  btnModeUrls.classList.add('active');
  btnModeQuery.classList.remove('active');
  urlsFields.classList.add('active');
  searchFields.classList.remove('active');
});

/* ==========================================================================
   Form Submission & Job Initiation
   ========================================================================== */

scraperForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Disable form and show loading
  setLoadingState(true);
  
  // Build payload
  const payload = {
    webhookUrl: document.getElementById('input-webhook').value.trim() || undefined
  };

  if (activeMode === 'query') {
    const businessStr = document.getElementById('input-business').value;
    const locationStr = document.getElementById('input-location').value;
    const titleStr = document.getElementById('input-title').value;
    const apolloUrl = document.getElementById('input-apollo').value.trim();

    payload.business = businessStr ? businessStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    payload.location = locationStr ? locationStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    payload.job_title = titleStr ? titleStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    
    if (apolloUrl) {
      payload.url = apolloUrl;
    }

    // Validation
    if (payload.business.length === 0 && payload.location.length === 0 && !apolloUrl) {
      alert('Please enter at least a business keyword and location, or provide an Apollo URL.');
      setLoadingState(false);
      return;
    }
  } else {
    const urlsText = document.getElementById('input-target-urls').value;
    payload.targetUrls = urlsText ? urlsText.split('\n').map(s => s.trim()).filter(s => s.startsWith('http')) : [];

    if (payload.targetUrls.length === 0) {
      alert('Please enter at least one valid website URL starting with http:// or https://');
      setLoadingState(false);
      return;
    }
  }

  try {
    // Post to create job
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify(payload)
    });

    if (response.status === 401) {
      handleSignOut();
      return;
    }

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Failed to start job');
    }

    const jobData = await response.json();
    currentJobId = jobData.jobId;
    
    // Reset results and hide screens
    allLeads = [];
    emptyState.classList.add('hidden');
    resultsCard.classList.add('hidden');
    statusCard.classList.remove('hidden');
    
    // Reset status layout
    statusBadge.textContent = 'Processing';
    statusBadge.className = 'status-badge';
    displayJobId.textContent = currentJobId;
    
    // Start polling status
    startPolling(currentJobId);
  } catch (err) {
    alert(`Scraper initialization failed: ${err.message}`);
    setLoadingState(false);
  }
});

function setLoadingState(isLoading) {
  if (isLoading) {
    submitButton.disabled = true;
    btnText.textContent = 'Processing...';
    btnLoader.classList.remove('hidden');
  } else {
    submitButton.disabled = false;
    btnText.textContent = 'Initialize Scraper';
    btnLoader.classList.add('hidden');
  }
}

/* ==========================================================================
   Polling Status Logic
   ========================================================================== */

function startPolling(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);
  
  let elapsedSeconds = 0;
  
  // Refresh stats immediately
  fetchStats();

  pollingInterval = setInterval(async () => {
    elapsedSeconds += 2;
    updateStatusMessage(elapsedSeconds);

    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`
        }
      });

      if (response.status === 401) {
        clearInterval(pollingInterval);
        handleSignOut();
        return;
      }

      if (!response.ok) throw new Error('Failed to retrieve job status');
      const job = await response.json();

      if (job.status === 'completed') {
        clearInterval(pollingInterval);
        allLeads = job.leads || [];
        showResults(allLeads);
        setLoadingState(false);
        fetchStats(); // update final stats
      } else if (job.status === 'failed') {
        clearInterval(pollingInterval);
        showFailure(job.error || 'An unexpected server error occurred during scraping.');
        setLoadingState(false);
        fetchStats();
      }
    } catch (err) {
      console.error('Status polling error:', err);
    }
  }, 2000);
}

// Dynamically cycles messages so the user knows what the scraper is doing
function updateStatusMessage(seconds) {
  if (seconds < 10) {
    statusMessage.textContent = 'Initializing Connection Pool...';
    statusDetail.textContent = 'Setting up premium headless browser instance and rotating HTTP proxies to bypass CAPTCHAs.';
  } else if (seconds < 25) {
    statusMessage.textContent = 'Discovering Business Websites...';
    statusDetail.textContent = 'Querying DuckDuckGo, Bing, and Google search engines in the background to harvest target business domains.';
  } else if (seconds < 45) {
    statusMessage.textContent = 'Crawling Homepages & Sub-pages...';
    statusDetail.textContent = 'Accessing homepages to capture page elements, headers, and enqueuing promising About/Contact pages.';
  } else {
    statusMessage.textContent = 'Extracting Lead Contacts...';
    statusDetail.textContent = 'Scanning raw page content to parse emails, phone numbers, and matching corporate social handles. Please stand by.';
  }
}

/* ==========================================================================
   Displaying Results / Failures
   ========================================================================== */

function showResults(leads) {
  statusCard.classList.add('hidden');
  resultsCard.classList.remove('hidden');

  leadsTableBody.innerHTML = '';
  
  if (leads.length === 0) {
    leadsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-table-cell">
          Scrape complete. No email lead contacts were discovered matching the search criteria.
        </td>
      </tr>
    `;
    exportCsvBtn.disabled = true;
    exportCsvBtn.style.opacity = '0.5';
    return;
  }

  exportCsvBtn.disabled = false;
  exportCsvBtn.style.opacity = '1';

  // Only display the first 10 results in the HTML table
  const displayLimit = leads.slice(0, 10);
  
  displayLimit.forEach(lead => {
    const tr = document.createElement('tr');
    
    // Format locations
    const locParts = [lead.city, lead.state, lead.country].filter(Boolean);
    const locationText = locParts.length > 0 ? locParts.join(', ') : 'N/A';
    
    // Website link HTML
    const websiteHtml = lead.organizationWebsite 
      ? `<a href="${lead.organizationWebsite}" target="_blank" rel="noopener">${lead.organizationWebsite.replace(/^https?:\/\//, '')}</a>` 
      : 'N/A';

    tr.innerHTML = `
      <td><strong>${lead.organizationName || 'N/A'}</strong></td>
      <td>${websiteHtml}</td>
      <td class="email-col">${lead.email || 'N/A'}</td>
      <td class="phone-col">${lead.phone || 'N/A'}</td>
      <td>${locationText}</td>
    `;
    
    leadsTableBody.appendChild(tr);
  });
}

function showFailure(errorMessage) {
  statusBadge.textContent = 'Failed';
  statusBadge.className = 'status-badge status-failed';
  statusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
  statusBadge.style.color = '#fca5a5';
  statusBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
  
  statusMessage.textContent = 'Job Execution Failed';
  statusDetail.textContent = errorMessage;
  
  // Custom styling for failed spinner
  const loaderCircle = statusCard.querySelector('.loader-circle');
  if (loaderCircle) {
    loaderCircle.style.animation = 'none';
    loaderCircle.style.borderTopColor = 'var(--danger)';
    loaderCircle.style.borderBottomColor = 'var(--danger)';
  }
}

/* ==========================================================================
   CSV Export Generation
   ========================================================================== */

exportCsvBtn.addEventListener('click', () => {
  if (allLeads.length === 0) return;

  const headers = ['Person ID', 'Company Name', 'Website', 'LinkedIn URL', 'Email', 'Phone', 'City', 'State', 'Country', 'Source Page'];
  
  const rows = allLeads.map(lead => [
    lead.personId || '',
    lead.organizationName || '',
    lead.organizationWebsite || '',
    lead.organizationLinkedinUrl || '',
    lead.email || '',
    lead.phone || '',
    lead.city || '',
    lead.state || '',
    lead.country || '',
    lead.sourceUrl || ''
  ]);

  // Convert array to CSV format escape strings properly
  const csvContent = [
    headers.join(','),
    ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  // Trigger download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `leads_export_${currentJobId.substring(0, 8)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});
