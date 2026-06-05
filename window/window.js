let environments = [];
let activeEnvId = null;
let logs = [];
let selectedLog = null;
let isPolling = false;
let readLogIds = new Set();
let elements = {};
let activeAppFilter = '';
let activeStatusFilter = '';
let activeUserFilter = 'all';
let currentUserName = null;
let logLineCache = [];

// Smart polling variables
const ACTIVE_INTERVAL = 3000; // 3 seconds when active
const INACTIVE_INTERVAL = 120000; // 2 minutes when inactive
const INACTIVITY_TIMEOUT = 300000; // 5 minutes before switching to slow polling

let currentPollingInterval = ACTIVE_INTERVAL;
let lastActivityTime = Date.now();
let activityTimerInterval = null;
let pollingProgressInterval = null;
let pollingProgress = 100;

// TraceFlag renewal variables
const TRACEFLAG_RENEWAL_INTERVAL = 3000000; // 50 minutes (3000 seconds)
let traceFlagRenewalInterval = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
  initElements();
  setupEventListeners();
  loadState();
}

function initElements() {
  elements = {
    envSelector: document.getElementById('envSelector'),
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    togglePollingBtn: document.getElementById('togglePollingBtn'),
    welcomeView: document.getElementById('welcomeView'),
    mainView: document.getElementById('mainView'),
    logsList: document.getElementById('logsList'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    logMeta: document.getElementById('detailMeta'),
    logBody: document.getElementById('logBody'),
    detailEmpty: document.getElementById('detailEmpty'),
    detailContent: document.getElementById('detailContent'),
    downloadBtn: document.getElementById('downloadBtn'),
    markAllReadBtn: document.getElementById('markAllReadBtn'),
    filterButtons: document.getElementById('filterButtons'),
    statusFilterButtons: document.getElementById('statusFilterButtons'),
    userFilterButtons: document.getElementById('userFilterButtons'),
    userName: document.getElementById('userName'),
    activityTimer: document.getElementById('activityTimer'),
    activityTimerValue: document.getElementById('activityTimerValue'),
    pollingBar: document.getElementById('pollingBar'),
    pollingInterval: document.getElementById('pollingInterval')
  };
}

function setupEventListeners() {
  elements.connectBtn.addEventListener('click', connectToActiveTab);
  elements.disconnectBtn.addEventListener('click', disconnect);
  elements.refreshBtn.addEventListener('click', fetchLogs);
  elements.togglePollingBtn.addEventListener('click', togglePolling);
  elements.envSelector.addEventListener('change', handleEnvChange);
  elements.downloadBtn.addEventListener('click', downloadLog);
  elements.markAllReadBtn.addEventListener('click', markAllAsRead);
  
  // Filter toggle buttons
  const filterHeaders = document.querySelectorAll('.filter-header');
  filterHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.filter-section');
      section.classList.toggle('collapsed');
    });
  });
  
  const filterBtns = elements.filterButtons.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAppFilter = btn.dataset.filter;
      filterLogs();
    });
  });
  
  const statusFilterBtns = elements.statusFilterButtons.querySelectorAll('.filter-btn');
  statusFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      statusFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatusFilter = btn.dataset.status;
      filterLogs();
    });
  });
  
  const userFilterBtns = elements.userFilterButtons.querySelectorAll('.filter-btn');
  userFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      userFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeUserFilter = btn.dataset.user;
      filterLogs();
    });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'polling-update') {
      if (message.error) {
        console.error('Polling error:', message.error);
        if (message.error.includes('Session expired')) {
          stopPolling();
          showSessionExpired();
        }
      } else {
        updateLogs(message.data);
      }
    }
  });

  // Activity detection - using event delegation on document
  document.addEventListener('click', handleUserActivity);
  document.addEventListener('scroll', handleUserActivity, true);
  document.addEventListener('mousemove', handleUserActivity);
  document.addEventListener('keydown', handleUserActivity);
}

async function loadState() {
  console.log('[DEBUG] [USER-FLOW] loadState started');
  const response = await sendMessage({ action: 'get-state' });
  console.log('[DEBUG] [USER-FLOW] get-state response:', response);
  
  if (response.success) {
    environments = response.environments;
    activeEnvId = response.activeEnvId;
    currentUserName = response.currentUserName || null;
    console.log('[DEBUG] [USER-FLOW] currentUserName from get-state:', currentUserName);
    
    updateEnvSelector();
    updateUserNameDisplay();
    updateUserFilterButton();
    
    if (activeEnvId) {
      showMainView();
      fetchLogs();
      startPolling();
      startTraceFlagRenewal();
    }
  }
  
  checkAutoConnect();
}

async function connectToActiveTab() {
  console.log('[DEBUG] Connecting to active tab...');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  elements.connectBtn.disabled = true;
  elements.connectBtn.textContent = '连接中...';
  
  try {
    const response = await sendMessage({
      action: 'connect-to-tab',
      tabId: tab.id
    });
    console.log('[DEBUG] connect-to-tab response:', response);
    
    if (response.success) {
      environments = response.environments;
      activeEnvId = response.envId;
      currentUserName = response.userName || null;
      updateEnvSelector();
      updateUserNameDisplay();
      updateUserFilterButton();
      showMainView();
      fetchLogs();
      startPolling();
      startTraceFlagRenewal();
    } else {
      alert('连接失败：' + (response.error || '未知错误'));
    }
  } catch (error) {
    alert('连接失败：' + error.message);
  } finally {
    elements.connectBtn.disabled = false;
    if (!activeEnvId) {
      elements.connectBtn.textContent = '连接';
    }
  }
}

async function disconnect() {
  if (!activeEnvId) return;
  
  console.log('[DEBUG] Disconnecting...');
  const response = await sendMessage({
    action: 'disconnect',
    envId: activeEnvId
  });
  console.log('[DEBUG] disconnect response:', response);
  
  if (response.success) {
    environments = response.environments;
    activeEnvId = null;
    currentUserName = null;
    stopPolling();
    stopTraceFlagRenewal();
    updateEnvSelector();
    showWelcomeView();
    selectedLog = null;
    showDetailEmpty();
  }
}

async function handleEnvChange() {
  const newEnvId = elements.envSelector.value;
  
  console.log('[DEBUG] Changing environment to:', newEnvId);
  if (!newEnvId) {
    if (activeEnvId) {
      stopPolling();
      stopTraceFlagRenewal();
      activeEnvId = null;
      currentUserName = null;
      showWelcomeView();
      selectedLog = null;
      showDetailEmpty();
    }
    return;
  }
  
  const response = await sendMessage({
    action: 'switch-environment',
    envId: newEnvId
  });
  console.log('[DEBUG] switch-environment response:', response);
  
  if (response.success) {
    environments = response.environments;
    activeEnvId = newEnvId;
    updateEnvSelector();
    showMainView();
    selectedLog = null;
    showDetailEmpty();
    fetchLogs();
    startPolling();
    startTraceFlagRenewal();
  } else {
    alert('切换环境失败：' + (response.error || '未知错误'));
  }
}

function showWelcomeView() {
  elements.welcomeView.style.display = 'flex';
  elements.mainView.style.display = 'none';
  elements.disconnectBtn.style.display = 'none';
}

function showMainView() {
  elements.welcomeView.style.display = 'none';
  elements.mainView.style.display = 'flex';
  elements.disconnectBtn.style.display = 'inline-flex';
  showDetailEmpty();
}

function showDetailEmpty() {
  elements.detailEmpty.style.display = 'flex';
  elements.detailContent.style.display = 'none';
}

function showDetailContent() {
  elements.detailEmpty.style.display = 'none';
  elements.detailContent.style.display = 'flex';
}

function updateEnvSelector() {
  elements.envSelector.innerHTML = '<option value="">选择环境</option>';
  
  environments.forEach(env => {
    const option = document.createElement('option');
    option.value = env.id;
    option.textContent = `${env.name} - ${env.hostname}`;
    if (env.id === activeEnvId) {
      option.selected = true;
    }
    elements.envSelector.appendChild(option);
  });
  
  if (activeEnvId) {
    elements.connectBtn.style.display = 'none';
  }
}

async function fetchLogs() {
  console.log('[DEBUG] Fetching logs...');
  elements.loadingState.style.display = 'flex';
  elements.emptyState.style.display = 'none';
  elements.logsList.innerHTML = '';
  
  try {
    const response = await sendMessage({
      action: 'fetch-logs',
      limit: 200
    });
    console.log('[DEBUG] fetch-logs response:', response);
    
    if (response.success) {
      updateLogs(response.data);
    } else {
      if (response.error === 'Session expired') {
        stopPolling();
        showSessionExpired();
      } else {
        throw new Error(response.error);
      }
    }
  } catch (error) {
    console.error('[DEBUG] Fetch logs error:', error);
    elements.loadingState.style.display = 'none';
    if (error.message === 'Session expired' || error.message === 'No active environment') {
      showSessionExpired();
    } else {
      elements.emptyState.style.display = 'flex';
      elements.emptyState.querySelector('p').textContent = '加载失败';
    }
  }
}

function updateLogs(data) {
  const newRecords = data?.records || [];
  console.log('[DEBUG] Received', newRecords.length, 'new log records');
  
  // Incremental update: merge new logs with existing, avoid duplicates
  const existingIds = new Set(logs.map(log => log.Id));
  const uniqueNewRecords = newRecords.filter(log => !existingIds.has(log.Id));
  
  console.log('[DEBUG] Unique new records:', uniqueNewRecords.length);
  
  if (uniqueNewRecords.length > 0) {
    // Add new logs to the beginning (newest first)
    logs = [...uniqueNewRecords, ...logs];
    
    // Sort by StartTime descending (newest first)
    logs.sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime));
    
    // Limit to 200 - remove oldest (at the end)
    if (logs.length > 200) {
      const removedCount = logs.length - 200;
      logs = logs.slice(0, 200);
      console.log('[DEBUG] Removed', removedCount, 'oldest logs, now have', logs.length);
    }
    
    console.log('[DEBUG] Total logs after update:', logs.length);
  }
  
  elements.loadingState.style.display = 'none';
  
  if (logs.length === 0) {
    elements.emptyState.style.display = 'flex';
    elements.logsList.innerHTML = '';
    updateLogsCount(0, 0);
  } else {
    elements.emptyState.style.display = 'none';
    filterLogs();
  }
}

function updateUserNameDisplay() {
  if (elements.userName) {
    elements.userName.textContent = currentUserName || '-';
  }
}

function updateUserFilterButton() {
  const currentUserBtn = document.getElementById('currentUserBtn');
  if (currentUserBtn && currentUserName) {
    currentUserBtn.textContent = currentUserName;
  }
}

function updateLogsCount(filteredCount, totalCount) {
  const countEl = document.getElementById('logsCount');
  if (countEl) {
    if (filteredCount === totalCount) {
      countEl.textContent = `${totalCount}`;
    } else {
      countEl.textContent = `${filteredCount}/${totalCount}`;
    }
  }
}

function filterLogs() {
  console.log('[DEBUG] Filter params - activeAppFilter:', activeAppFilter, 
    'activeStatusFilter:', activeStatusFilter, 
    'activeUserFilter:', activeUserFilter,
    'currentUserName:', currentUserName);
  
  // 支持多语言的"成功"状态判断
  const successStatuses = ['Success', '成功', '成功', '成功'];
  
  const filtered = logs.filter(log => {
    const matchesApp = !activeAppFilter || log.Application === activeAppFilter;
    
    let matchesStatus = true;
    if (activeStatusFilter === 'success') {
      matchesStatus = successStatuses.includes(log.Status);
    } else if (activeStatusFilter === 'error') {
      matchesStatus = !successStatuses.includes(log.Status);
    }
    
    let matchesUser = true;
    if (activeUserFilter === 'current' && currentUserName) {
      matchesUser = log.LogUser?.Name === currentUserName;
    }
    
    // 打印每个日志的匹配结果
    if (!matchesUser) {
      console.log('[DEBUG] Log filtered out - LogUser:', log.LogUser?.Name, 
        'currentUserName:', currentUserName);
    }
    
    return matchesApp && matchesStatus && matchesUser;
  });
  
  // 打印所有日志的用户列表
  const allUsers = [...new Set(logs.map(l => l.LogUser?.Name).filter(Boolean))];
  console.log('[DEBUG] All users in logs:', allUsers);
  console.log('[DEBUG] Filtered logs:', filtered.length, 'total:', logs.length);
  updateLogsCount(filtered.length, logs.length);
  renderLogs(filtered);
}

function renderLogs(logsToRender) {
  elements.logsList.innerHTML = '';
  
  logsToRender.forEach(log => {
    const card = createLogCard(log);
    elements.logsList.appendChild(card);
  });
}

function createLogCard(log) {
  const type = log.Application || 'System';
  const duration = log.DurationMilliseconds || 0;
  const durationClass = duration > 5000 ? 'error' : duration > 1000 ? 'slow' : '';
  const status = log.Status || 'Unknown';
  // 支持多语言的"成功"状态判断
  const successStatuses = ['Success', '成功', '成功', '成功']; // 可添加更多语言
  const isSuccess = successStatuses.includes(status);
  const isSelected = selectedLog?.Id === log.Id;
  const isRead = readLogIds.has(log.Id);
  
  const card = document.createElement('div');
  card.className = `log-card ${isSelected ? 'selected' : ''} ${isRead ? 'read' : ''}`;
  
  card.innerHTML = `
    <div class="log-card-header">
      <div class="log-header-left">
        <span class="log-status ${isSuccess ? 'success' : 'error'}">
          ${isSuccess ? '✓ 成功' : '✗ ' + status}
        </span>
        <span class="log-operation">${log.Operation || 'Unknown Operation'}</span>
      </div>
      <div class="log-header-right">
        <span class="log-type ${type}">${log.Application || 'Unknown'}</span>
      </div>
    </div>
    <div class="log-meta">
      <div class="log-meta-item">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M7 0a7 7 0 100 14A7 7 0 007 0zm0 1.5v6.5l3 1.8"/>
        </svg>
        <span>${formatDate(log.StartTime)}</span>
      </div>
      <div class="log-meta-item">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M7 0a4 4 0 100 8 4 4 0 000-8zm0 1.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"/>
        </svg>
        <span>${formatSize(log.LogLength || 0)}</span>
      </div>
      <div class="log-meta-item">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M7 2a1 1 0 011 1v4h3a1 1 0 010 2H8v3a1 1 0 01-2 0V9H3a1 1 0 010-2h3V3a1 1 0 011-1z"/>
        </svg>
        <span>${log.Request || 'Unknown'}</span>
      </div>
    </div>
    <div class="log-footer">
      <div class="log-footer-left">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M7 0a4 4 0 100 8 4 4 0 000-8zm0 1.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"/>
        </svg>
        <span class="log-user">${log.LogUser?.Name || 'Unknown User'}</span>
      </div>
      <span class="log-duration ${durationClass}">${formatDuration(duration)}</span>
    </div>
  `;
  
  card.addEventListener('click', () => openLogDetail(log));
  
  return card;
}

async function openLogDetail(log) {
  console.log('[DEBUG] Opening log detail:', log.Id);
  selectedLog = log;
  
  readLogIds.add(log.Id);
  
  filterLogs();
  
  showDetailContent();
  
  const status = log.Status || 'Unknown';
  const successStatuses = ['Success', '成功', '成功']; // English,中文，日本語
  const isSuccess = successStatuses.includes(status);
  
  const metaItems = [
    { label: '状态', value: status, isStatus: true, isSuccess: isSuccess },
    { label: '操作', value: log.Operation || 'Unknown' },
    { label: '应用', value: log.Application || 'Unknown' },
    { label: '请求', value: log.Request || 'Unknown' },
    { label: '位置', value: log.Location || 'Unknown' },
    { label: '用户', value: log.LogUser?.Name || 'Unknown' },
    { label: '耗时', value: formatDuration(log.DurationMilliseconds || 0) },
    { label: '大小', value: formatSize(log.LogLength || 0) },
    { label: '时间', value: new Date(log.StartTime).toLocaleString() }
  ];
  
  elements.logMeta.innerHTML = metaItems.map(item => {
    if (item.isStatus) {
      return `
        <div class="detail-meta-item detail-status-item">
          <span>${item.label}：</span>
          <strong class="status-badge ${item.isSuccess ? 'success' : 'error'}">${item.value}</strong>
        </div>
      `;
    }
    return `
      <div class="detail-meta-item">
        <span>${item.label}：</span>
        <strong>${item.value}</strong>
      </div>
    `;
  }).join('');
  
  try {
    const response = await sendMessage({
      action: 'fetch-log-body',
      logId: log.Id
    });
    console.log('[DEBUG] fetch-log-body response:', response.success ? 'success' : 'failed');
    
    if (response.success) {
      displayLogBody(response.data);
    } else {
      elements.logBody.innerHTML = '<div class="log-line"><div class="log-line-content">加载失败：' + response.error + '</div></div>';
    }
  } catch (error) {
    console.error('[DEBUG] fetch-log-body error:', error);
    elements.logBody.innerHTML = '<div class="log-line"><div class="log-line-content">加载失败：' + error.message + '</div></div>';
  }
}

function displayLogBody(body) {
  if (!body) {
    logLineCache = [];
    elements.logBody.innerHTML = '<div class="log-line"><div class="log-line-content">日志内容为空</div></div>';
    return;
  }
  
  const logText = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  logLineCache = logText.split('\n');
  console.log('[DEBUG] Displaying log body with', logLineCache.length, 'lines');
  
  elements.logBody.innerHTML = logLineCache.map((line, index) => {
    let contentClass = '';
    if (line.includes('ERROR') || line.includes('FATAL')) {
      contentClass = 'error';
    } else if (line.includes('WARN')) {
      contentClass = 'warning';
    } else if (line.includes('DEBUG') || line.includes('|DEBUG|')) {
      contentClass = 'debug';
    } else if (line.includes('|INFO|')) {
      contentClass = 'info';
    }
    
    const escapedLine = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    return `
      <div class="log-line" data-index="${index}">
        <div class="log-line-number">${index + 1}</div>
        <button class="log-line-copy" title="复制">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <div class="log-line-content ${contentClass}">${escapedLine}</div>
      </div>
    `;
  }).join('');
  
  const copyBtns = elements.logBody.querySelectorAll('.log-line-copy');
  copyBtns.forEach((btn, index) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lineIndex = parseInt(btn.closest('.log-line').dataset.index);
      if (logLineCache[lineIndex]) {
        navigator.clipboard.writeText(logLineCache[lineIndex]).then(() => {
          btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          `;
          setTimeout(() => {
            btn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            `;
          }, 1000);
        }).catch(err => {
          console.error('[DEBUG] Copy error:', err);
        });
      }
    });
  });
}

function downloadLog() {
  if (!selectedLog) return;
  
  const content = JSON.stringify({
    metadata: {
      id: selectedLog.Id,
      operation: selectedLog.Operation,
      application: selectedLog.Application,
      user: selectedLog.LogUser?.Name,
      startTime: selectedLog.StartTime,
      duration: selectedLog.DurationMilliseconds,
      size: selectedLog.LogLength
    },
    body: logLineCache.join('\n')
  }, null, 2);
  
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apex-log-${selectedLog.Id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function showSessionExpired() {
  elements.welcomeView.style.display = 'flex';
  elements.mainView.style.display = 'none';
  elements.disconnectBtn.style.display = 'none';
  elements.connectBtn.style.display = 'inline-flex';
  elements.connectBtn.textContent = '重新连接';
}

function markAllAsRead() {
  logs.forEach(log => readLogIds.add(log.Id));
  filterLogs();
}

function startPolling() {
  if (isPolling) return;
  
  console.log('[DEBUG] Starting polling...');
  isPolling = true;
  elements.togglePollingBtn.classList.add('active');
  
  sendMessage({ action: 'start-polling' });
}

function stopPolling() {
  if (!isPolling) return;
  
  console.log('[DEBUG] Stopping polling...');
  isPolling = false;
  elements.togglePollingBtn.classList.remove('active');
  
  sendMessage({ action: 'stop-polling' });
  
  // Stop activity timer and polling progress
  stopActivityTimer();
  stopPollingProgress();
}

function startTraceFlagRenewal() {
  if (traceFlagRenewalInterval) return;
  
  console.log('[DEBUG] Starting TraceFlag renewal timer...');
  
  // Renew immediately when starting
  renewTraceFlag();
  
  // Then renew every 50 minutes
  traceFlagRenewalInterval = setInterval(renewTraceFlag, TRACEFLAG_RENEWAL_INTERVAL);
}

function stopTraceFlagRenewal() {
  if (traceFlagRenewalInterval) {
    console.log('[DEBUG] Stopping TraceFlag renewal timer...');
    clearInterval(traceFlagRenewalInterval);
    traceFlagRenewalInterval = null;
  }
}

async function renewTraceFlag() {
  if (!activeEnvId) return;
  
  console.log('[DEBUG] Renewing TraceFlag...');
  
  try {
    const response = await sendMessage({ action: 'renew-traceflag' });
    if (response.success) {
      console.log('[DEBUG] TraceFlag renewed successfully');
    } else {
      console.error('[DEBUG] Failed to renew TraceFlag:', response.error);
    }
  } catch (error) {
    console.error('[DEBUG] Error renewing TraceFlag:', error.message);
  }
}

function togglePolling() {
  if (isPolling) {
    stopPolling();
  } else {
    startPolling();
  }
}

function handleUserActivity() {
  lastActivityTime = Date.now();
  resetActivityTimer();
  
  // If we were in slow polling mode, switch back to active mode
  if (currentPollingInterval !== ACTIVE_INTERVAL) {
    console.log('[DEBUG] Activity detected, switching to fast polling');
    switchToActivePolling();
  }
}

function resetActivityTimer() {
  stopActivityTimer();
  
  activityTimerInterval = setInterval(() => {
    const now = Date.now();
    const inactiveMs = now - lastActivityTime;
    const inactiveSeconds = Math.floor(inactiveMs / 1000);
    
    updateActivityTimerDisplay(inactiveSeconds);
    
    // Check if we should switch to slow polling
    if (inactiveSeconds >= INACTIVITY_TIMEOUT / 1000 && currentPollingInterval === ACTIVE_INTERVAL) {
      console.log('[DEBUG] Inactivity timeout reached, switching to slow polling');
      switchToSlowPolling();
    }
  }, 1000);
}

function stopActivityTimer() {
  if (activityTimerInterval) {
    clearInterval(activityTimerInterval);
    activityTimerInterval = null;
  }
}

function updateActivityTimerDisplay(seconds) {
  if (!elements.activityTimerValue) return;
  
  elements.activityTimerValue.textContent = seconds;
  
  // Update visual state
  elements.activityTimer.classList.remove('warning', 'critical');
  if (seconds >= INACTIVITY_TIMEOUT / 1000) {
    elements.activityTimer.classList.add('critical');
  } else if (seconds >= (INACTIVITY_TIMEOUT / 1000) * 0.7) {
    elements.activityTimer.classList.add('warning');
  }
}

function switchToActivePolling() {
  currentPollingInterval = ACTIVE_INTERVAL;
  
  // Update polling interval display
  if (elements.pollingInterval) {
    elements.pollingInterval.textContent = '3s';
  }
  
  // Update polling bar
  if (elements.pollingBar) {
    elements.pollingBar.classList.remove('slow');
  }
  
  // Restart polling with new interval
  if (isPolling) {
    stopPolling();
    startPolling();
  }
  
  // Reset activity timer
  lastActivityTime = Date.now();
  resetActivityTimer();
  
  // Restart polling progress animation
  startPollingProgress();
}

function switchToSlowPolling() {
  currentPollingInterval = INACTIVE_INTERVAL;
  
  // Update polling interval display
  if (elements.pollingInterval) {
    elements.pollingInterval.textContent = '2m';
  }
  
  // Update polling bar
  if (elements.pollingBar) {
    elements.pollingBar.classList.add('slow');
  }
  
  // Restart polling with new interval
  if (isPolling) {
    stopPolling();
    startPolling();
  }
  
  // Restart polling progress animation
  startPollingProgress();
}

function startPollingProgress() {
  stopPollingProgress();
  
  pollingProgress = 100;
  
  const updateInterval = Math.max(100, currentPollingInterval / 100); // Update at least every 100ms
  
  pollingProgressInterval = setInterval(() => {
    pollingProgress -= (100 / (currentPollingInterval / updateInterval));
    
    if (pollingProgress <= 0) {
      pollingProgress = 100;
    }
    
    updatePollingProgressDisplay();
  }, updateInterval);
}

function stopPollingProgress() {
  if (pollingProgressInterval) {
    clearInterval(pollingProgressInterval);
    pollingProgressInterval = null;
  }
}

function updatePollingProgressDisplay() {
  if (!elements.pollingBar) return;
  
  elements.pollingBar.style.width = `${pollingProgress}%`;
}

function startPolling() {
  if (isPolling) return;
  
  console.log('[DEBUG] Starting polling with interval:', currentPollingInterval);
  isPolling = true;
  elements.togglePollingBtn.classList.add('active');
  
  // Start activity timer
  resetActivityTimer();
  
  // Start polling progress animation
  startPollingProgress();
  
  sendMessage({ action: 'start-polling', interval: currentPollingInterval });
}

function formatDate(dateString) {
  const date = new Date(dateString);
  
  // 显示具体时间格式：YYYY-MM-DD HH:mm:ss
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function checkAutoConnect() {
  if (activeEnvId) return;
  
  console.log('[DEBUG] Checking for auto-connect...');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab && tab.url && (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))) {
    console.log('[DEBUG] Found Salesforce tab, attempting auto-connect...');
    await connectToActiveTab();
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    console.log('[DEBUG] Sending message:', message);
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message;
        if (errorMessage.includes('Could not establish connection') || 
            errorMessage.includes('Receiving end does not exist')) {
          console.warn('[DEBUG] Background script not ready yet, retrying...');
          setTimeout(() => {
            sendMessage(message).then(resolve).catch(reject);
          }, 500);
        } else {
          reject(new Error(errorMessage));
        }
      } else {
        resolve(response);
      }
    });
  });
}