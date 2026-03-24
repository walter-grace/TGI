/**
 * sh-monitor-tgi-health
 * Self-heal monitor for TGI (TrelloGI) daemon health endpoint.
 * 
 * Monitors: TGI /health endpoint
 * Returns: 200 OK if healthy, 503 Service Unavailable if not
 */

const TGI_HEALTH_URL = "https://tgi-daemon.fly.dev/health";
const REQUEST_TIMEOUT_MS = 5000; // 5 second timeout
const MAX_RETRIES = 2;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

async function checkHealth(retryCount = 0) {
  try {
    const response = await fetchWithTimeout(
      TGI_HEALTH_URL,
      { method: 'GET' },
      REQUEST_TIMEOUT_MS
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (data.ok !== true) {
      throw new Error('Health check returned ok: false');
    }
    
    return { healthy: true, data };
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      // Exponential backoff: 500ms, 1000ms
      await new Promise(r => setTimeout(r, 500 * (retryCount + 1)));
      return checkHealth(retryCount + 1);
    }
    return { healthy: false, error: error.message };
  }
}

export default {
  async fetch(request, env, ctx) {
    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    const result = await checkHealth();
    
    if (result.healthy) {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          tgi: result.data
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          }
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: result.error
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Retry-After': '30'
          }
        }
      );
    }
  },
  
  // Scheduled trigger for periodic health checks
  async scheduled(event, env, ctx) {
    const result = await checkHealth();
    
    if (!result.healthy) {
      // Log the failure - in production this could trigger alerts
      console.error(`[sh-monitor-tgi-health] Health check failed: ${result.error}`);
    } else {
      console.log('[sh-monitor-tgi-health] Health check passed');
    }
  }
};
