import axios from 'axios';

/**
 * Fires a webhook callback to a given URL with the payload.
 *
 * @param {string} webhookUrl  - The callback URL to POST to
 * @param {object} payload     - The JSON payload to deliver
 */
export async function fireWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;

  try {
    console.log(`[Webhook] Firing callback to: ${webhookUrl}`);
    const response = await axios.post(webhookUrl, payload, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'lead-scraper',
      },
    });
    console.log(`[Webhook] Successfully delivered. Status: ${response.status}`);
  } catch (error) {
    console.error(`[Webhook] Delivery failed to ${webhookUrl}: ${error.message}`);
  }
}
