const FLOW_URL = 'https://labs.google/fx/tools/flow';

const statusBox = document.getElementById('statusBox');
const statusDot = document.getElementById('statusDot');
const statusTitle = document.getElementById('statusTitle');
const statusDesc = document.getElementById('statusDesc');
const openPanelBtn = document.getElementById('openPanelBtn');
const refreshBtn = document.getElementById('refreshBtn');
const helpBtn = document.getElementById('helpBtn');

let activeTab = null;
let isFlowPage = false;

function updateStatus({ detected, tabUrl }) {
  isFlowPage = detected;

  if (detected) {
    statusBox.style.borderColor = 'rgba(52,199,89,0.4)';
    statusDot.style.background = 'var(--success)';
    statusTitle.textContent = 'Flow 页面已检测到';
    statusDesc.textContent = tabUrl;

    openPanelBtn.disabled = false;
    refreshBtn.disabled = false;
  } else {
    statusBox.style.borderColor = 'rgba(255,69,58,0.3)';
    statusDot.style.background = 'var(--danger)';
    statusTitle.textContent = '未检测到 Flow 页面';
    statusDesc.textContent = '请打开 Flow Labs 官方页面';

    openPanelBtn.disabled = true;
    refreshBtn.disabled = true;
  }
}

function detectActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    activeTab = tabs[0];
    if (!activeTab) {
      updateStatus({ detected: false });
      return;
    }

    const url = activeTab.url || '';
    const detected = url.startsWith('https://labs.google/fx');
    updateStatus({ detected, tabUrl: detected ? url : '当前页面不是 Flow' });
  });
}

function openFlowPage() {
  chrome.tabs.create({ url: FLOW_URL });
  window.close();
}

openPanelBtn.addEventListener('click', () => {
  if (!activeTab) {
    openFlowPage();
    return;
  }

  if (!isFlowPage) {
    chrome.tabs.update(activeTab.id, { url: FLOW_URL });
    window.close();
    return;
  }

  chrome.tabs.sendMessage(activeTab.id, { type: 'FLOW_BATCH_OPEN_PANEL' }, (response) => {
    if (chrome.runtime.lastError) {
      // 内容脚本可能未注入，刷新当前页面
      chrome.tabs.reload(activeTab.id);
      setTimeout(() => {
        chrome.tabs.update(activeTab.id, { url: FLOW_URL });
      }, 200);
      window.close();
      return;
    }

    if (!response || !response.ok) {
      chrome.tabs.update(activeTab.id, { url: FLOW_URL });
    }
    window.close();
  });
});

refreshBtn.addEventListener('click', () => {
  if (activeTab) {
    chrome.tabs.reload(activeTab.id);
  }
  window.close();
});

helpBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://github.com/FlowBatchPilot' });
});

document.addEventListener('DOMContentLoaded', detectActiveTab);

