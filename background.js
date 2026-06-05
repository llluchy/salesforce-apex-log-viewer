const SALESFORCE_API_VERSION = 'v59.0';

// Environment storage
let environments = {}; // { envId: { sessionId, instanceUrl, connectedAt } }
let activeEnvId = null;
let pollingInterval = null;

// Keep track of opened window to avoid duplicates
let logViewerWindowId = null;

// Open window when clicking extension icon
chrome.action.onClicked.addListener(async (tab) => {
  // If window already exists, focus it
  if (logViewerWindowId) {
    try {
      await chrome.windows.update(logViewerWindowId, { focused: true });
      return;
    } catch (e) {
      // Window no longer exists, reset id
      logViewerWindowId = null;
    }
  }
  
  // Try to auto-detect current Salesforce page BEFORE creating window
  // This ensures user name is fetched before window.js loads
  if (tab.url && (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))) {
    console.log('[DEBUG] [USER-FLOW] Auto-detecting environment before window creation');
    await autoDetectEnvironment(tab.id, tab.url);
    console.log('[DEBUG] [USER-FLOW] Auto-detect completed, now creating window');
  }
  
  // Create new window
  const window = await chrome.windows.create({
    url: 'window/index.html',
    type: 'popup',
    width: 500,
    height: 700,
    left: 100,
    top: 100
  });
  
  if (window.id) {
    logViewerWindowId = window.id;
  }
});

// Listen for window closed event to reset id
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === logViewerWindowId) {
    logViewerWindowId = null;
  }
});

// Auto-detect environment from active tab
async function autoDetectEnvironment(tabId, url) {
  console.log('[DEBUG] [USER-FLOW] autoDetectEnvironment started, tabId:', tabId, 'url:', url);
  try {
    // Clear old userName first - never use cached data
    if (activeEnvId && environments[activeEnvId]) {
      console.log('[DEBUG] [USER-FLOW] Clearing old userName before fetching new one');
      environments[activeEnvId].userName = undefined;
    }
    
    const session = await extractSessionFromTab(tabId);
    console.log('[DEBUG] [USER-FLOW] Session extracted:', session ? 'SUCCESS' : 'FAILED');
    
    if (session) {
      const envId = await addEnvironment(session);
      console.log('[DEBUG] [USER-FLOW] Environment added, envId:', envId);
      
      activeEnvId = envId;
      
      // Fetch and save current user name
      console.log('[DEBUG] [USER-FLOW] Calling fetchCurrentUserName(envId:', envId + ')');
      const userName = await fetchCurrentUserName(envId);
      console.log('[DEBUG] [USER-FLOW] fetchCurrentUserName returned:', userName);
      
      if (userName) {
        environments[envId].userName = userName;
        console.log('[DEBUG] [USER-FLOW] Saved user name to environment:', userName);
      } else {
        console.log('[DEBUG] [USER-FLOW] User name is null, not saving');
      }
      
      // Enable debug logging (create TraceFlag)
      console.log('[DEBUG] [USER-FLOW] Calling enableDebugLogging(envId:', envId + ')');
      await enableDebugLogging(envId);
      
      await saveState();
      console.log('[DEBUG] [USER-FLOW] State saved');
    }
  } catch (error) {
    console.log('[DEBUG] [USER-FLOW] autoDetectEnvironment failed:', error);
  }
}

// Extract session from tab
async function extractSessionFromTab(tabId) {
  try {
    // First check the tab URL
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) {
      console.log('Tab URL is empty');
      return null;
    }
    
    // Check if it's a chrome-extension URL or non-Salesforce URL
    if (tab.url.startsWith('chrome-extension://')) {
      console.log('Cannot access chrome-extension URL');
      return null;
    }
    if (!tab.url.includes('salesforce.com') && !tab.url.includes('force.com') && 
        !tab.url.includes('cloudforce.com') && !tab.url.includes('visualforce.com')) {
      console.log('Not a Salesforce URL:', tab.url);
      return null;
    }

    console.log('Extracting session from:', tab.url);

    // First get the correct Salesforce host
    const sfHost = await getSfHost(tab.url, tab.cookieStoreId);
    console.log('Using Salesforce host:', sfHost);

    if (!sfHost) {
      console.log('Could not determine Salesforce host');
      return null;
    }

    // Now get the session from the correct host
    const session = await getSession(sfHost, tab.cookieStoreId);
    
    if (session) {
      console.log('Session extracted successfully');
      return {
        sessionId: session.key,
        instanceUrl: `https://${session.hostname}`,
        hostname: session.hostname
      };
    }
    
    console.log('No session found');
    return null;
  } catch (error) {
    console.error('Extract session failed:', error);
    return null;
  }
}

// Get the correct Salesforce host (from the reference project)
async function getSfHost(url, cookieStoreId) {
  try {
    const currentDomain = new URL(url).hostname;
    
    // First try to get the sid from current URL
    const currentSid = await chrome.cookies.get({
      url: url,
      name: "sid",
      storeId: cookieStoreId
    });
    
    if (!currentSid) {
      return currentDomain;
    }
    
    // If we have a sid, extract the org ID and find the correct domain
    const [orgId] = currentSid.value.split("!");
    const orderedDomains = [
      "salesforce.com", 
      "cloudforce.com", 
      "salesforce.mil", 
      "cloudforce.mil", 
      "sfcrmproducts.cn", 
      "force.com",
      "my.salesforce.com",
      "lightning.force.com"
    ];
    
    // Check each domain in order
    for (const domain of orderedDomains) {
      try {
        const cookies = await chrome.cookies.getAll({
          name: "sid",
          domain: domain,
          secure: true,
          storeId: cookieStoreId
        });
        
        const sessionCookie = cookies.find(c => 
          c.value.startsWith(orgId + "!") && 
          c.domain !== "help.salesforce.com"
        );
        
        if (sessionCookie) {
          console.log('Found correct domain:', sessionCookie.domain);
          return sessionCookie.domain;
        }
      } catch (error) {
        console.log('Error checking domain', domain, ':', error);
      }
    }
    
    // Fall back to current domain
    return currentDomain;
  } catch (error) {
    console.error('Error in getSfHost:', error);
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
}

// Get session from host (from the reference project)
async function getSession(sfHost, cookieStoreId) {
  try {
    const cookie = await chrome.cookies.get({
      name: "sid",
      storeId: cookieStoreId,
      url: "https://" + sfHost
    });
    
    if (!cookie) {
      console.log('No sid cookie found for host:', sfHost);
      return null;
    }
    
    return {
      key: cookie.value,
      hostname: cookie.domain
    };
  } catch (error) {
    console.error('Error in getSession:', error);
    return null;
  }
}

// Add new environment
async function addEnvironment(session) {
  const envId = generateEnvId(session.instanceUrl);
  
  console.log('Adding environment:', {
    envId,
    instanceUrl: session.instanceUrl,
    hostname: session.hostname,
    sessionPrefix: session.sessionId?.substring(0, 20) + '...'
  });
  
  // Check if already exists
  if (environments[envId]) {
    console.log('Environment already exists, updating session and clearing old userName');
    // Update existing session and CLEAR old userName to force re-fetch
    environments[envId] = {
      ...environments[envId],
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now(),
      userName: undefined // Clear old user name to force re-fetch
    };
  } else {
    console.log('Creating new environment');
    environments[envId] = {
      id: envId,
      name: getEnvName(session.instanceUrl),
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now()
    };
  }
  
  return envId;
}

// Generate environment ID from URL
function generateEnvId(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  return btoa(hostname).replace(/[^a-zA-Z0-9]/g, '');
}

// Get environment display name
function getEnvName(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  if (hostname.includes('sandbox') || hostname.includes('cs')) {
    return 'Sandbox';
  }
  if (hostname.includes('test')) {
    return 'Test';
  }
  return 'Production';
}

// Test connection
async function testConnection(envId) {
  const env = environments[envId];
  if (!env) return { success: false, error: 'Environment not found' };
  
  try {
    const url = `${env.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/limits`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.sessionId}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      // Session expired
      delete environments[envId];
      await saveState();
      return { success: false, error: 'Session expired' };
    } else {
      return { success: false, error: 'Connection failed' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Make API request
async function makeApiRequest(endpoint, options = {}) {
  const env = environments[activeEnvId];
  if (!env) {
    throw new Error('No active environment');
  }
  
  const url = env.instanceUrl + endpoint;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${env.sessionId}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      // Mark environment as expired but don't delete immediately
      environments[activeEnvId].sessionExpired = true;
      await saveState();
      
      // Try to refresh session from active Salesforce tabs
      const refreshed = await tryRefreshSession(activeEnvId);
      if (refreshed) {
        // Retry with new session
        return await makeApiRequest(endpoint, options);
      }
      
      throw new Error('Session expired');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    if (response.status === 204) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    throw error;
  }
}

// Try to refresh session by looking for active Salesforce tabs
async function tryRefreshSession(envId) {
  try {
    const env = environments[envId];
    if (!env) return false;
    
    // Get all tabs
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))) {
        try {
          const session = await extractSessionFromTab(tab.id);
          if (session) {
            const newEnvId = generateEnvId(session.instanceUrl);
            if (newEnvId === envId) {
              // Update the session
              environments[envId] = {
                ...environments[envId],
                sessionId: session.sessionId,
                sessionExpired: false,
                connectedAt: Date.now()
              };
              await saveState();
              console.log('Session refreshed successfully');
              return true;
            }
          }
        } catch (e) {
          console.log('Error trying to refresh from tab:', e);
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error in tryRefreshSession:', error);
    return false;
  }
}

// Fetch Apex Logs
async function fetchApexLogs(limit = 50) {
  const env = environments[activeEnvId];
  if (!env) {
    throw new Error('No active environment');
  }
  
  const soql = `
    SELECT Id, Status, Request, Operation, Application,
           StartTime, Location, LogUserId, LogUser.Name,
           DurationMilliseconds, LogLength
    FROM ApexLog
    ORDER BY StartTime DESC
    LIMIT ${limit}
  `.replace(/\s+/g, ' ').trim();
  
  const query = encodeURIComponent(soql);
  const result = await makeApiRequest(`/services/data/${SALESFORCE_API_VERSION}/query/?q=${query}`);
  
  return result;
}

// Fetch current user name via API
async function fetchCurrentUserName(envId) {
  console.log('[DEBUG] [USER-FLOW] fetchCurrentUserName called, envId:', envId);
  
  const env = environments[envId];
  console.log('[DEBUG] [USER-FLOW] Environment exists:', !!env);
  
  if (!env) {
    console.log('[DEBUG] [USER-FLOW] Environment not found, returning null');
    return null;
  }
  
  try {
    // Use Chatter API to get current user
    const endpoint = `/services/data/${SALESFORCE_API_VERSION}/chatter/users/me`;
    console.log('[DEBUG] [USER-FLOW] Calling makeApiRequestForEnv with endpoint:', endpoint);
    
    const result = await makeApiRequestForEnv(envId, endpoint);
    console.log('[DEBUG] [USER-FLOW] API response received:', result ? 'OK' : 'NULL');
    console.log('[DEBUG] [USER-FLOW] API response full:', JSON.stringify(result));
    
    if (result?.name) {
      const userName = result.name;
      console.log('[DEBUG] [USER-FLOW] User name found:', userName);
      return userName;
    } else if (result) {
      console.log('[DEBUG] [USER-FLOW] Response exists but no name field:', Object.keys(result));
    }
    console.log('[DEBUG] [USER-FLOW] Returning null (no name found)');
    return null;
  } catch (error) {
    console.error('[DEBUG] [USER-FLOW] fetchCurrentUserName error:', error.message);
    return null;
  }
}

// Debug Level name for Apex Log Viewer
const DEBUG_LEVEL_NAME = 'ApexLogViewer_Debug';

// Create or get DebugLevel for trace flag (using Tooling API)
async function getOrCreateDebugLevel(envId) {
  console.log('[DEBUG] [TRACE-FLAG] getOrCreateDebugLevel called, envId:', envId);
  
  try {
    // First, try to find existing DebugLevel (Tooling API)
    const soql = `SELECT Id FROM DebugLevel WHERE DeveloperName = '${DEBUG_LEVEL_NAME}' LIMIT 1`;
    const queryResult = await makeApiRequestForEnv(envId, `/services/data/${SALESFORCE_API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`);
    
    if (queryResult?.records?.length > 0) {
      console.log('[DEBUG] [TRACE-FLAG] Found existing DebugLevel:', queryResult.records[0].Id);
      return queryResult.records[0].Id;
    }
    
    // Create new DebugLevel if not found (Tooling API)
    console.log('[DEBUG] [TRACE-FLAG] Creating new DebugLevel');
    const debugLevelData = {
      DeveloperName: DEBUG_LEVEL_NAME,
      MasterLabel: 'Apex Log Viewer Debug',
      ApexCode: 'Finest',
      ApexProfiling: 'Finest',
      Callout: 'Finest',
      Database: 'Finest',
      System: 'Finest',
      Validation: 'Finest',
      Workflow: 'Finest'
    };
    
    console.log('[DEBUG] [TRACE-FLAG] DebugLevel data:', JSON.stringify(debugLevelData));
    const endpoint = `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/DebugLevel`;
    console.log('[DEBUG] [TRACE-FLAG] Creating DebugLevel at endpoint:', endpoint);
    
    const createResult = await makeApiRequestForEnv(envId, endpoint, {
      method: 'POST',
      body: JSON.stringify(debugLevelData)
    });
    
    console.log('[DEBUG] [TRACE-FLAG] Create DebugLevel result:', JSON.stringify(createResult));
    
    if (createResult?.id) {
      console.log('[DEBUG] [TRACE-FLAG] Created DebugLevel with Id:', createResult.id);
      return createResult.id;
    }
    
    console.error('[DEBUG] [TRACE-FLAG] Failed to create DebugLevel:', createResult);
    return null;
  } catch (error) {
    console.error('[DEBUG] [TRACE-FLAG] getOrCreateDebugLevel error:', error.message);
    return null;
  }
}

// Create or update TraceFlag for current user (using Tooling API)
async function createTraceFlag(envId, debugLevelId) {
  console.log('[DEBUG] [TRACE-FLAG] createTraceFlag called, envId:', envId, 'debugLevelId:', debugLevelId);
  
  if (!debugLevelId) {
    console.error('[DEBUG] [TRACE-FLAG] No DebugLevelId provided');
    return null;
  }
  
  try {
    // First, get current user ID (using Chatter API - not Tooling API)
    const userInfo = await makeApiRequestForEnv(envId, `/services/data/${SALESFORCE_API_VERSION}/chatter/users/me`);
    
    if (!userInfo?.id) {
      console.error('[DEBUG] [TRACE-FLAG] Could not get current user ID');
      return null;
    }
    
    const userId = userInfo.id;
    console.log('[DEBUG] [TRACE-FLAG] Current user ID:', userId);
    
    // Check if there's already an existing TraceFlag for this user with our DebugLevel
    const soql = `SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND DebugLevelId = '${debugLevelId}' LIMIT 1`;
    console.log('[DEBUG] [TRACE-FLAG] Checking existing TraceFlag with SOQL:', soql);
    
    const existingResult = await makeApiRequestForEnv(envId, `/services/data/${SALESFORCE_API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`);
    console.log('[DEBUG] [TRACE-FLAG] Existing TraceFlag query result:', JSON.stringify(existingResult));
    
    // Calculate new expiration date (1 hour from now)
    const startDate = new Date();
    const expirationDate = new Date(startDate.getTime() + 1 * 60 * 60 * 1000);
    
    let resultId = null;
    
    if (existingResult?.records?.length > 0) {
      // Update existing TraceFlag
      const existingId = existingResult.records[0].Id;
      console.log('[DEBUG] [TRACE-FLAG] Found existing TraceFlag, updating:', existingId);
      
      const updateData = {
        StartDate: startDate.toISOString(),
        ExpirationDate: expirationDate.toISOString()
      };
      
      const updateEndpoint = `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag/${existingId}`;
      console.log('[DEBUG] [TRACE-FLAG] Updating TraceFlag at:', updateEndpoint);
      
      await makeApiRequestForEnv(envId, updateEndpoint, {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      });
      
      resultId = existingId;
      console.log('[DEBUG] [TRACE-FLAG] Updated TraceFlag with Id:', resultId);
    } else {
      // Create new TraceFlag
      console.log('[DEBUG] [TRACE-FLAG] No existing TraceFlag found, creating new one (1 hour duration)');
      
      const traceFlagData = {
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: 'USER_DEBUG',
        StartDate: startDate.toISOString(),
        ExpirationDate: expirationDate.toISOString()
      };
      
      console.log('[DEBUG] [TRACE-FLAG] Creating TraceFlag with data:', JSON.stringify(traceFlagData));
      
      const createEndpoint = `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag`;
      console.log('[DEBUG] [TRACE-FLAG] Creating TraceFlag at:', createEndpoint);
      
      const createResult = await makeApiRequestForEnv(envId, createEndpoint, {
        method: 'POST',
        body: JSON.stringify(traceFlagData)
      });
      
      console.log('[DEBUG] [TRACE-FLAG] Create TraceFlag result:', JSON.stringify(createResult));
      
      if (createResult?.id) {
        resultId = createResult.id;
        console.log('[DEBUG] [TRACE-FLAG] Created TraceFlag with Id:', resultId);
      } else {
        console.error('[DEBUG] [TRACE-FLAG] Failed to create TraceFlag:', createResult);
      }
    }
    
    return resultId;
  } catch (error) {
    console.error('[DEBUG] [TRACE-FLAG] createTraceFlag error:', error.message);
    return null;
  }
}

// Enable debug logging by creating TraceFlag
async function enableDebugLogging(envId) {
  console.log('[DEBUG] [TRACE-FLAG] enableDebugLogging called, envId:', envId);
  
  try {
    // Step 1: Get or create DebugLevel
    const debugLevelId = await getOrCreateDebugLevel(envId);
    if (!debugLevelId) {
      console.error('[DEBUG] [TRACE-FLAG] Could not get or create DebugLevel');
      return false;
    }
    
    // Step 2: Create TraceFlag for current user
    const traceFlagId = await createTraceFlag(envId, debugLevelId);
    if (!traceFlagId) {
      console.error('[DEBUG] [TRACE-FLAG] Could not create TraceFlag');
      return false;
    }
    
    console.log('[DEBUG] [TRACE-FLAG] Debug logging enabled successfully');
    return true;
  } catch (error) {
    console.error('[DEBUG] [TRACE-FLAG] enableDebugLogging error:', error.message);
    return false;
  }
}

// Make API request for specific environment
async function makeApiRequestForEnv(envId, endpoint, options = {}) {
  console.log('[DEBUG] [USER-FLOW] makeApiRequestForEnv called, envId:', envId, 'endpoint:', endpoint);
  
  const env = environments[envId];
  console.log('[DEBUG] [USER-FLOW] Environment found:', !!env);
  
  if (!env) {
    console.log('[DEBUG] [USER-FLOW] makeApiRequestForEnv: Environment not found');
    throw new Error('Environment not found');
  }
  
  const url = env.instanceUrl + endpoint;
  console.log('[DEBUG] [USER-FLOW] Request URL:', url);
  console.log('[DEBUG] [USER-FLOW] Session ID prefix:', env.sessionId?.substring(0, 20) + '...');
  
  try {
    console.log('[DEBUG] [USER-FLOW] Starting fetch...');
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${env.sessionId}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    console.log('[DEBUG] [USER-FLOW] Fetch completed, status:', response.status, 'ok:', response.ok);
    
    if (response.status === 401) {
      console.log('[DEBUG] [USER-FLOW] Response status 401 - Session expired');
      throw new Error('Session expired');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('[DEBUG] [USER-FLOW] API request failed, status:', response.status, 'error:', errorText);
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    if (response.status === 204) {
      console.log('[DEBUG] [USER-FLOW] Response status 204 - No content');
      return null;
    }
    
    const jsonResult = await response.json();
    console.log('[DEBUG] [USER-FLOW] JSON parsed successfully, keys:', jsonResult ? Object.keys(jsonResult) : 'null');
    return jsonResult;
  } catch (error) {
    console.log('[DEBUG] [USER-FLOW] makeApiRequestForEnv error:', error.message);
    throw error;
  }
}

// Fetch log body
async function fetchLogBody(logId) {
  const env = environments[activeEnvId];
  if (!env) {
    throw new Error('No active environment');
  }
  
  const url = `${env.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/sobjects/ApexLog/${logId}/Body`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.sessionId}`
      }
    });
    
    if (response.status === 401) {
      environments[activeEnvId].sessionExpired = true;
      await saveState();
      
      const refreshed = await tryRefreshSession(activeEnvId);
      if (refreshed) {
        return await fetchLogBody(logId);
      }
      
      throw new Error('Session expired');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    return await response.text();
  } catch (error) {
    throw error;
  }
}

// Start polling
function startPolling(callback, intervalMs = 3000) {
  stopPolling();
  
  pollingInterval = setInterval(async () => {
    if (activeEnvId && environments[activeEnvId] && !environments[activeEnvId].sessionExpired) {
      try {
        const result = await fetchApexLogs();
        callback(null, result);
      } catch (error) {
        // If session expired, stop polling
        if (error.message === 'Session expired') {
          stopPolling();
          callback(error, null);
        } else {
          callback(error, null);
        }
      }
    }
  }, intervalMs);
  
  // Initial fetch
  if (activeEnvId && environments[activeEnvId] && !environments[activeEnvId].sessionExpired) {
    (async () => {
      try {
        const result = await fetchApexLogs();
        callback(null, result);
      } catch (error) {
        callback(error, null);
      }
    })();
  }
}

// Stop polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Save state to storage
async function saveState() {
  await chrome.storage.local.set({
    'salesforce-environments': environments,
    'salesforce-active-env': activeEnvId
  });
}

// Load state from storage
async function loadState() {
  const result = await chrome.storage.local.get([
    'salesforce-environments',
    'salesforce-active-env'
  ]);
  
  environments = result['salesforce-environments'] || {};
  activeEnvId = result['salesforce-active-env'];
}

// Initialize
loadState();

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'connect-to-tab': {
          const session = await extractSessionFromTab(message.tabId);
          if (!session) {
            sendResponse({ success: false, error: 'Could not extract session' });
            return;
          }
          
          const envId = await addEnvironment(session);
          const testResult = await testConnection(envId);
          
          if (testResult.success) {
            activeEnvId = envId;
            environments[envId].sessionExpired = false;
            
            // Fetch and save current user name
            const userName = await fetchCurrentUserName(envId);
            if (userName) {
              environments[envId].userName = userName;
              console.log('[DEBUG] Saved user name to environment:', userName);
            }
            
            // Enable debug logging (create TraceFlag)
            await enableDebugLogging(envId);
            
            await saveState();
            sendResponse({ 
              success: true, 
              envId, 
              environments: Object.values(environments),
              userName: environments[envId].userName
            });
          } else {
            sendResponse({ success: false, error: testResult.error });
          }
          break;
        }
        
        case 'refresh-session': {
          if (!message.tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            return;
          }
          
          const session = await extractSessionFromTab(message.tabId);
          if (!session) {
            sendResponse({ success: false, error: 'Could not extract session' });
            return;
          }
          
          const envId = await addEnvironment(session);
          const testResult = await testConnection(envId);
          
          if (testResult.success) {
            if (!activeEnvId) {
              activeEnvId = envId;
            }
            environments[envId].sessionExpired = false;
            
            // Fetch and save current user name
            const userName = await fetchCurrentUserName(envId);
            if (userName) {
              environments[envId].userName = userName;
              console.log('[DEBUG] Saved user name to environment:', userName);
            }
            
            // Enable debug logging (create TraceFlag)
            await enableDebugLogging(envId);
            
            await saveState();
            sendResponse({ 
              success: true, 
              envId, 
              environments: Object.values(environments),
              userName: environments[envId].userName
            });
          } else {
            sendResponse({ success: false, error: testResult.error });
          }
          break;
        }
        
        case 'disconnect': {
          delete environments[message.envId];
          if (activeEnvId === message.envId) {
            activeEnvId = null;
            stopPolling();
          }
          await saveState();
          sendResponse({ success: true, environments: Object.values(environments) });
          break;
        }
        
        case 'switch-environment': {
          const testResult = await testConnection(message.envId);
          if (testResult.success) {
            activeEnvId = message.envId;
            await saveState();
            sendResponse({ 
              success: true, 
              environments: Object.values(environments) 
            });
          } else {
            sendResponse({ success: false, error: testResult.error });
          }
          break;
        }
        
        case 'get-state': {
          sendResponse({
            success: true,
            environments: Object.values(environments),
            activeEnvId,
            currentUserName: activeEnvId ? environments[activeEnvId]?.userName : null
          });
          break;
        }
        
        case 'fetch-logs': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }
          
          const logs = await fetchApexLogs(message.limit);
          sendResponse({ success: true, data: logs });
          break;
        }
        
        case 'fetch-log-body': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }
          
          const body = await fetchLogBody(message.logId);
          sendResponse({ success: true, data: body });
          break;
        }
        
        case 'start-polling': {
          startPolling((error, data) => {
            chrome.runtime.sendMessage({
              action: 'polling-update',
              error: error?.message,
              data
            });
          }, message.interval || 3000);
          sendResponse({ success: true });
          break;
        }
        
        case 'stop-polling': {
          stopPolling();
          sendResponse({ success: true });
          break;
        }
        
        case 'renew-traceflag': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }
          
          console.log('[DEBUG] [TRACE-FLAG] Renewing TraceFlag...');
          const result = await enableDebugLogging(activeEnvId);
          
          if (result) {
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Failed to renew TraceFlag' });
          }
          break;
        }
        
        default: {
          sendResponse({ success: false, error: 'Unknown action' });
        }
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true;
});
