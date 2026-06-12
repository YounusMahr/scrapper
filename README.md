# Lead Scraper Platform

A production-ready business lead scraping service built using Node.js, Express, and **Crawlee + Playwright**. It extracts business information, emails, phone numbers, and social links based on search queries or list of target URLs.

---

## Features

- **Automated Discovery**: Uses DuckDuckGo (HTML), Bing, and Google search fallbacks to locate business websites from queries.
- **Robust Crawler**: Deep crawls websites to scrape contacts, checking about/contact pages automatically.
- **Premium Proxy Pool**: Supports automatic rotation, failover, dynamic updates without restarts, and CAPTCHA-awareness.
- **Containerized Setup**: Modern Docker config with support for running headless browsers seamlessly on server instances.
- **Webhooks**: Notifies external systems automatically when a scraping job completes.

---

## API Endpoints

### 1. Health Diagnostics
Checks server status and uptime.
* **URL**: `/health`
* **Method**: `GET`
* **Response**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-06-12T05:23:00.000Z",
    "uptime": 12.34
  }
  ```

### 2. Create Scraper Job
Triggers search discovery and contact crawling.
* **URL**: `/api/jobs`
* **Method**: `POST`
* **Headers**: `Content-Type: application/json`
* **Request Body**:
  ```json
  {
    "location": ["Austin, TX"],
    "business": ["HVAC"],
    "job_title": ["Owner"],
    "webhookUrl": "https://your-webhook-receiver.com/callback"
  }
  ```
  *Alternatively, pass raw URLs directly:*
  ```json
  {
    "targetUrls": ["https://example-business.com"],
    "webhookUrl": "https://your-webhook-receiver.com/callback"
  }
  ```
* **Response (Status 202 Accepted)**:
  ```json
  {
    "jobId": "a3b2c1d0-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "status": "processing",
    "message": "Scraper started successfully. Leads will be posted to the webhookUrl once complete."
  }
  ```

---

## Proxy Configuration

The proxy system is designed to load premium HTTP proxies from a file in the workspace root:
`proxyscrape_premium_http_proxies.txt`

### Supported Formats
Lines in the proxy file can use any of the following structures:
- `user:pass@host:port`
- `user:pass:host:port`
- `host:port:user:pass`
- `http://host:port`

> [!TIP]
> The proxy pool is **dynamically reloaded** at the start of every scraping job. You can update `proxyscrape_premium_http_proxies.txt` on the fly without restarting the server!

### Cooldown and Block Detection
- If a proxy encounters a CAPTCHA or blocking signature (e.g. Rate limits, Access Denied), it is marked as failed.
- Failed proxies enter a **2-minute cooldown** period and are excluded from rotation.
- If all proxies fail, the system force-resets the oldest failed proxy to ensure scraping continues.

---

## Local Development

### 1. Installation
Install project dependencies:
```bash
npm install
```

### 2. Run in Development Mode
Starts the server with nodemon to watch file changes:
```bash
npm run dev
```

### 3. Run Proxy System Tests
Verifies proxy loading and parsing:
```bash
npm test
```

---

## Production Deployment (Docker & AWS EC2)

The service is fully dockerized and uses a base image optimized for running headless browsers.

### docker-compose Setup
Build and run the container locally or on staging:
```bash
docker-compose up -d --build
```

### GitHub Actions Deployment
Pushing commits to the `main` branch triggers the GitHub workflow `.github/workflows/deploy.yml` which:
1. Logins and SSHes into your AWS EC2 instance.
2. Pulls the latest code.
3. Builds the Docker image based on `apify/actor-node:20`.
4. Deploys the container on port `5000`.
5. Configures Nginx with reverse proxy and certbot SSL encryption.
