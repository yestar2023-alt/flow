/**
 * FlowBatchPilot 2.0 - Popup JavaScript
 *
 * ARCHITECTURE COMPLIANCE:
 * - Minimal Storage: Only metadata stored in chrome.storage.local (< 1KB)
 * - Dynamic File Transfer: Files transmitted on-demand via messaging
 * - Professional UI/UX: Real-time status updates, progress tracking, logging
 * - Three-Zone Layout: Data Input | Status Preview | Control Buttons
 * - Robust Error Handling: Comprehensive error recovery and user feedback
 */

class FlowBatchPilot {
  constructor() {
    this.initializeElements();
    this.attachEventListeners();
    this.setupMessaging();
    this.loadStoredState();
    this.initializeUI();
    this.preloadedFiles = new Map();
    this.queueId = null;
    // CRITICAL FIX: FileCacheDB is not implemented yet, so we skip it
    // Files are cached in memory (preloadedFiles Map) which is sufficient
    this.fileCacheDB = null;
  }

  // ===============================
  // ELEMENT INITIALIZATION
  // ===============================

  initializeElements() {
    // Input Elements
    this.promptInput = document.getElementById('promptInput');
    this.imageFolder = document.getElementById('imageFolder');
    this.flowMode = document.getElementById('flowMode');
    this.cropMode = document.getElementById('cropMode');

    // UI Feedback Elements
    this.folderLabel = document.getElementById('folderLabel');
    this.folderText = document.getElementById('folderText');
    this.previewBody = document.getElementById('previewBody');

    // Status Elements
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusText = document.getElementById('statusText');
    this.progressFill = document.getElementById('progressFill');
    this.currentTask = document.getElementById('currentTask');
    this.successCount = document.getElementById('successCount');
    this.failCount = document.getElementById('failCount');
    this.logContainer = document.getElementById('logContainer');

    // Control Buttons
    this.startBtn = document.getElementById('startBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.clearBtn = document.getElementById('clearBtn');

    // Internal State
    this.currentFiles = [];
    this.queueState = null;
    this.logEntries = [];
  }

  // ===============================
  // EVENT LISTENERS
  // ===============================

  attachEventListeners() {
    // Input listeners with REAL-TIME PERSISTENCE
    this.promptInput.addEventListener('input', () => {
      this.updatePreview();
      this.saveUIState();
    });

    this.imageFolder.addEventListener('change', (e) => this.handleFolderSelection(e));

    // Settings listeners with REAL-TIME PERSISTENCE
    this.flowMode.addEventListener('change', () => this.saveUIState());
    this.cropMode.addEventListener('change', () => this.saveUIState());

    // Control buttons
    this.startBtn.addEventListener('click', () => this.startQueue());
    this.pauseBtn.addEventListener('click', () => this.pauseQueue());
    this.clearBtn.addEventListener('click', () => this.clearQueue());

    // Connection test button
    this.testConnectionBtn = document.getElementById('testConnectionBtn');
    this.testConnectionBtn.addEventListener('click', () => this.testConnection());
  }

  // ===============================
  // MESSAGING SYSTEM
  // ===============================

  setupMessaging() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // CRITICAL FIX: Handle async operations properly
      this.handleMessage(message, sender, sendResponse).catch(error => {
        console.error('[FlowBatchPilot] Unhandled error in message handler:', error);
        if (sendResponse && !sendResponse.called) {
          sendResponse({ ok: false, error: error.message });
        }
      });
      return true; // Keep message channel open for async responses
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'FLOW_BATCH_STATUS_UPDATE':
          this.handleStatusUpdate(message.data);
          sendResponse({ ok: true });
          return;

        case 'FLOW_BATCH_LOG_ENTRY':
          this.addLogEntry(message.data.message, message.data.type);
          sendResponse({ ok: true });
          return;

        case 'FLOW_BATCH_REQUEST_FILE':
          // CRITICAL FIX: handleFileRequest is async, need to await it
          await this.handleFileRequest(message.fileIndex, sendResponse);
          return;

        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
          return;
      }
    } catch (error) {
      console.error('[FlowBatchPilot] Error handling message:', error);
      if (sendResponse && !sendResponse.called) {
        sendResponse({ ok: false, error: error.message });
      }
    }
  }

  // ===============================
  // STORAGE MANAGEMENT (Minimal)
  // ===============================

  async loadStoredState() {
    try {
      // CRITICAL FIX: Load persistent UI state
      const result = await chrome.storage.local.get([
        'flowBatchQueueState',
        'flowBatchTaskMetadata',
        'flowBatchUIState' // New: Persistent UI state
      ]);

      this.queueState = result.flowBatchQueueState || null;
      this.queueId = this.queueState?.queueId || null;

      if (this.queueId) {
        await this.loadStoredFileCache(this.queueId);
      }

      if (this.queueState) {
        this.updateUIFromState();
      }

      // RESTORE UI STATE
      if (result.flowBatchUIState) {
        this.restoreUIState(result.flowBatchUIState);
        this.addLogEntry('界面状态已恢复', 'success');
      }

      this.addLogEntry('系统初始化完成', 'success');
    } catch (error) {
      this.addLogEntry(`存储加载失败: ${error.message}`, 'error');
    }
  }

  restoreUIState(uiState) {
    // Restore prompts
    if (uiState.promptInput) {
      this.promptInput.value = uiState.promptInput;
    }

    // Restore flow mode
    if (uiState.flowMode) {
      this.flowMode.value = uiState.flowMode;
    }

    // Restore crop mode
    if (uiState.cropMode) {
      this.cropMode.value = uiState.cropMode;
    }

    // Restore files info (not actual files, just metadata)
    if (uiState.fileInfo && uiState.fileInfo.length > 0) {
      // We can't restore actual File objects, but we can restore the file count
      this.folderText.textContent = `${uiState.fileInfo.length} 个文件已选择（需要重新选择）`;
      this.folderLabel.classList.add('has-files');
      this.addLogEntry(`文件信息已恢复：${uiState.fileInfo.length} 个文件，请重新选择文件夹`, 'warning');
    }

    // Update preview after restoring
    this.updatePreview();
  }

  async saveState(queueState, metadata = null) {
    try {
      const data = {};

      if (queueState) {
        data.flowBatchQueueState = queueState;
        this.queueState = queueState;
      }

      if (metadata) {
        data.flowBatchTaskMetadata = metadata;
      }

      await chrome.storage.local.set(data);
    } catch (error) {
      this.addLogEntry(`状态保存失败: ${error.message}`, 'error');
      throw error;
    }
  }

  // CRITICAL FIX: Real-time UI state persistence
  async saveUIState() {
    try {
      const uiState = {
        promptInput: this.promptInput.value,
        flowMode: this.flowMode.value,
        cropMode: this.cropMode.value,
        fileInfo: this.currentFiles.map(file => ({
          name: file.name,
          size: file.size,
          type: file.type
        })),
        lastUpdated: Date.now()
      };

      await chrome.storage.local.set({ flowBatchUIState: uiState });
    } catch (error) {
      // Silently fail for UI state saving to avoid disrupting user experience
      console.warn('UI state save failed:', error);
    }
  }

  // ===============================
  // FILE HANDLING
  // ===============================

  handleFolderSelection(event) {
    const files = Array.from(event.target.files);

    if (files.length === 0) {
      this.currentFiles = [];
      this.folderText.textContent = '选择图片文件夹...';
      this.folderLabel.classList.remove('has-files');
      this.addLogEntry('文件夹选择已清空', 'warning');
      this.saveUIState(); // Save empty state
      return;
    }

    // Sort files by name (numerical sorting for 001.jpg, 002.jpg, etc.)
    this.currentFiles = this.sortFilesByName(files);

    this.folderText.textContent = `${files.length} 个文件已选择`;
    this.folderLabel.classList.add('has-files');

    this.addLogEntry(`已选择 ${files.length} 个图片文件`, 'success');
    this.updatePreview();
    this.saveUIState(); // Save file selection
  }

  sortFilesByName(files) {
    return files.sort((a, b) => {
      // Extract numerical part from filename for proper sorting
      const extractNumber = (filename) => {
        const match = filename.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };

      return extractNumber(a.name) - extractNumber(b.name);
    });
  }

  // ===============================
  // ===============================
  // DRAG AND DROP REORDERING
  // ===============================

  setupDragAndDrop() {
    const rows = this.previewBody.querySelectorAll('tr[draggable="true"]');
    rows.forEach(row => {
      row.addEventListener('dragstart', (e) => this.handleDragStart(e));
      row.addEventListener('dragend', (e) => this.handleDragEnd(e));
      row.addEventListener('dragover', (e) => this.handleDragOver(e));
      row.addEventListener('dragenter', (e) => this.handleDragEnter(e));
      row.addEventListener('dragleave', (e) => this.handleDragLeave(e));
      row.addEventListener('drop', (e) => this.handleDrop(e));
    });
  }

  handleDragStart(e) {
    const row = e.target.closest('tr');
    if (!row) return;
    this.draggedRow = row;
    this.draggedIndex = parseInt(row.dataset.index, 10);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.index);
  }

  handleDragEnd(e) {
    const row = e.target.closest('tr');
    if (row) row.classList.remove('dragging');
    this.previewBody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
    this.draggedRow = null;
    this.draggedIndex = null;
  }

  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  handleDragEnter(e) {
    e.preventDefault();
    const row = e.target.closest('tr');
    if (row && row !== this.draggedRow && row.hasAttribute('draggable')) {
      row.classList.add('drag-over');
    }
  }

  handleDragLeave(e) {
    const row = e.target.closest('tr');
    if (row) row.classList.remove('drag-over');
  }

  handleDrop(e) {
    e.preventDefault();
    const targetRow = e.target.closest('tr');
    if (!targetRow || !targetRow.hasAttribute('draggable') || targetRow === this.draggedRow) return;
    const targetIndex = parseInt(targetRow.dataset.index, 10);
    const fromIndex = this.draggedIndex;
    if (fromIndex !== targetIndex) {
      this.reorderFiles(fromIndex, targetIndex);
      this.addLogEntry(`图片顺序已调整: ${fromIndex + 1} → ${targetIndex + 1}`, 'success');
    }
  }

  reorderFiles(fromIndex, toIndex) {
    const [movedFile] = this.currentFiles.splice(fromIndex, 1);
    this.currentFiles.splice(toIndex, 0, movedFile);
    this.updatePreview();
    this.saveUIState();
  }

  // ===============================
  // FILE PRELOAD & CACHE
  // ===============================
  // ===============================

  async preloadQueueFiles(taskCount, queueId) {
    if (!queueId) return;

    this.preloadedFiles.clear();
    this.addLogEntry(`开始预加载 ${taskCount} 个文件...`, 'info');

    for (let i = 0; i < taskCount; i++) {
      const file = this.currentFiles[i];
      if (!file) break;

      const arrayBuffer = await this.fileToArrayBuffer(file);
      const base64Data = await this.arrayBufferToBase64(arrayBuffer);

      const entry = {
        index: i,
        name: file.name,
        type: file.type,
        size: file.size,
        base64Data
      };

      this.preloadedFiles.set(`${queueId}:${i}`, entry);

      if ((i + 1) % 5 === 0 || i === taskCount - 1) {
        this.addLogEntry(`文件预加载进度: ${i + 1}/${taskCount}`, 'info');
      }
    }

    await this.persistPreloadedFiles(queueId);
    this.addLogEntry('文件预加载完成', 'success');
  }

  async persistPreloadedFiles(queueId) {
    if (!queueId) return;

    // CRITICAL FIX: Check if fileCacheDB exists before using it
    if (this.fileCacheDB && typeof this.fileCacheDB.setFiles === 'function') {
      try {
        const entries = Array.from(this.preloadedFiles.entries())
          .filter(([key]) => key.startsWith(`${queueId}:`))
          .map(([, entry]) => entry);
        await this.fileCacheDB.setFiles(queueId, entries);
      } catch (error) {
        console.warn('[FlowBatchPilot] Failed to persist files to IndexedDB:', error);
      }
    }
    // Files are already cached in memory (preloadedFiles Map), which is sufficient
  }

  async loadStoredFileCache(queueId) {
    if (!queueId) {
      this.preloadedFiles.clear();
      return;
    }

    // CRITICAL FIX: Check if fileCacheDB exists before using it
    if (this.fileCacheDB && typeof this.fileCacheDB.getFiles === 'function') {
      try {
        const rows = await this.fileCacheDB.getFiles(queueId);
        if (rows && rows.length > 0) {
          this.preloadedFiles = new Map(
            rows.map(row => [`${queueId}:${row.data.index}`, row.data])
          );
          this.addLogEntry(`已加载缓存文件: ${rows.length} 个`, 'info');
          return;
        }
      } catch (error) {
        console.warn('[FlowBatchPilot] Failed to load files from IndexedDB:', error);
      }
    }

    // If fileCacheDB doesn't exist or failed, just clear memory cache
    // Files will be loaded on-demand from currentFiles
    this.preloadedFiles.clear();
  }

  async getStoredFileEntry(queueId, fileIndex) {
    if (!queueId && !this.queueId) return null;
    const effectiveQueueId = queueId || this.queueId;
    const cacheKey = `${effectiveQueueId}:${fileIndex}`;

    if (this.preloadedFiles.has(cacheKey)) {
      return this.preloadedFiles.get(cacheKey);
    }

    await this.loadStoredFileCache(effectiveQueueId);
    return this.preloadedFiles.get(cacheKey) || null;
  }

  async clearPreloadedFiles(queueId) {
    const effectiveQueueId = queueId || this.queueId;
    if (!effectiveQueueId) return;

    // CRITICAL FIX: Check if fileCacheDB exists before calling
    if (this.fileCacheDB && typeof this.fileCacheDB.clearQueue === 'function') {
      try {
        await this.fileCacheDB.clearQueue(effectiveQueueId);
        this.addLogEntry(`已清理缓存文件 (queueId: ${effectiveQueueId})`, 'info');
      } catch (error) {
        this.addLogEntry(`清理缓存文件失败: ${error.message}`, 'warning');
      }
    }

    // Always clear memory cache
    if (this.queueId === effectiveQueueId) {
      this.preloadedFiles.clear();
    }
  }

  async handleFileRequest(fileIndex, sendResponse) {
    // CRITICAL FIX: Track if response was sent to prevent double response
    let responseSent = false;

    const safeSendResponse = (data) => {
      if (!responseSent && sendResponse) {
        responseSent = true;
        try {
          sendResponse(data);
        } catch (error) {
          console.error('[FlowBatchPilot] Error sending response:', error);
        }
      }
    };

    try {
      const queueId = this.queueId || this.queueState?.queueId || null;
      const cacheKey = queueId ? `${queueId}:${fileIndex}` : null;

      const respondWithEntry = async (entry, source = 'cache') => {
        safeSendResponse({ ok: true, fileData: entry });
        this.addLogEntry(`文件传输完成 (${source}): ${entry.name} (${entry.size} bytes)`, 'success');
      };

      let fileEntry = cacheKey ? await this.getStoredFileEntry(queueId, fileIndex) : null;

      if (!fileEntry) {
        const file = this.currentFiles[fileIndex];

        if (!file) {
          safeSendResponse({
            ok: false,
            error: `无效的文件索引: ${fileIndex}`
          });
          return;
        }

        // Convert File to base64
        const arrayBuffer = await this.fileToArrayBuffer(file);
        const base64Data = await this.arrayBufferToBase64(arrayBuffer);

        fileEntry = {
          index: fileIndex,
          name: file.name,
          type: file.type,
          size: file.size,
          base64Data
        };

        if (cacheKey) {
          this.preloadedFiles.set(cacheKey, fileEntry);
          // CRITICAL FIX: Check if fileCacheDB exists before using it
          if (this.fileCacheDB && typeof this.fileCacheDB.setFile === 'function') {
            try {
              await this.fileCacheDB.setFile(queueId, fileEntry);
            } catch (error) {
              console.warn('[FlowBatchPilot] Failed to save file to IndexedDB:', error);
              // Continue anyway, file is already cached in memory
            }
          }
        }

        await respondWithEntry(fileEntry, 'live');
        return;
      }

      await respondWithEntry(fileEntry, 'cache');
    } catch (error) {
      this.addLogEntry(`文件传输失败: ${error.message}`, 'error');
      safeSendResponse({
        ok: false,
        error: error.message
      });
    }
  }


  // CRITICAL FIX: Convert File to ArrayBuffer for serializable transmission
  async fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  // Convert ArrayBuffer to Base64 for safe transmission
  async arrayBufferToBase64(arrayBuffer) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // Remove data URL prefix to get pure base64
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ===============================
  // PREVIEW MANAGEMENT
  // ===============================

  updatePreview() {
    const prompts = this.getPrompts();
    const taskCount = Math.min(prompts.length, this.currentFiles.length);

    if (prompts.length === 0 && this.currentFiles.length === 0) {
      this.previewBody.innerHTML = `
        <tr>
          <td colspan="5" class="preview-empty">请输入提示词并选择图片文件夹</td>
        </tr>
      `;
      return;
    }

    let html = '';

    for (let i = 0; i < taskCount; i++) {
      const prompt = prompts[i];
      const file = this.currentFiles[i];
      const promptPreview = prompt.length > 30 ?
        prompt.substring(0, 30) + '...' : prompt;

      html += `
        <tr draggable="true" data-index="${i}">
          <td class="drag-handle" title="拖拽调整顺序">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/>
            </svg>
          </td>
          <td class="thumbnail-cell">
            <img class="task-thumbnail" data-file-index="${i}" alt="${file.name}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
          </td>
          <td class="task-index">${i + 1}</td>
          <td class="task-prompt" title="${prompt.replace(/"/g, '&quot;')}">${promptPreview}</td>
          <td class="task-filename" title="${file.name}">${file.name.length > 8 ? file.name.substring(0, 6) + '...' : file.name}</td>
          <td class="task-actions">
            <button class="delete-btn" data-index="${i}" title="删除此图片">
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M9 2a1 1 0 0 0-.894.553L7.382 4H4a1 1 0 0 0 0 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a1 1 0 1 0 0-2h-3.382l-.724-1.447A1 1 0 0 0 11 2H9zM7 8a1 1 0 0 1 2 0v6a1 1 0 1 1-2 0V8zm5-1a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1z" clip-rule="evenodd"/>
              </svg>
            </button>
          </td>
        </tr>
      `;
    }

    // Show warning if counts don't match
    if (prompts.length !== this.currentFiles.length) {
      const diff = Math.abs(prompts.length - this.currentFiles.length);
      const moreType = prompts.length > this.currentFiles.length ? '提示词' : '图片';
      html += `
        <tr>
          <td colspan="6" class="preview-warning">
            ⚠️ ${moreType}多 ${diff} 个，将只处理 ${taskCount} 个任务
          </td>
        </tr>
      `;
    }

    this.previewBody.innerHTML = html;

    // Setup drag and drop
    this.setupDragAndDrop();

    // Load thumbnails asynchronously
    this.loadThumbnails();

    // Setup delete buttons
    this.setupDeleteButtons();
  }

  loadThumbnails() {
    const thumbnails = this.previewBody.querySelectorAll('.task-thumbnail');
    thumbnails.forEach(img => {
      const fileIndex = parseInt(img.dataset.fileIndex, 10);
      const file = this.currentFiles[fileIndex];
      if (file) {
        const url = URL.createObjectURL(file);
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
      }
    });
  }

  setupDeleteButtons() {
    const deleteButtons = this.previewBody.querySelectorAll('.delete-btn');
    deleteButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        this.removeFile(index);
      });
    });
  }

  removeFile(index) {
    if (index < 0 || index >= this.currentFiles.length) return;

    const fileName = this.currentFiles[index].name;
    this.currentFiles.splice(index, 1);
    this.updatePreview();
    this.saveUIState();
    this.addLogEntry(`已删除图片: ${fileName}`, 'warning');

    // Update folder label
    if (this.currentFiles.length > 0) {
      this.folderText.textContent = `${this.currentFiles.length} 个文件已选择`;
    } else {
      this.folderText.textContent = '选择图片文件夹...';
      this.folderLabel.classList.remove('has-files');
    }
  }

  getPrompts() {
    return this.promptInput.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // ===============================
  // QUEUE MANAGEMENT
  // ===============================

  async startQueue() {
    try {
      this.setUIState('preparing');
      this.addLogEntry('开始初始化队列...', 'info');

      const prompts = this.getPrompts();
      const taskCount = Math.min(prompts.length, this.currentFiles.length);

      if (taskCount === 0) {
        throw new Error('没有有效的任务可执行。请确保提示词和图片都已正确配置。');
      }

      const previousQueueId = this.queueId;
      const queueId = Date.now().toString();
      this.queueId = queueId;
      await this.clearPreloadedFiles(previousQueueId);

      // Build minimal metadata for storage (< 1KB)
      const metadata = {
        totalTasks: taskCount,
        promptList: prompts.slice(0, taskCount),
        filenameList: this.currentFiles.slice(0, taskCount).map(f => f.name),
        flowMode: this.flowMode.value,
        cropMode: this.cropMode.value,
        createdAt: Date.now(),
        queueId
      };

      // Build lightweight queue state
      const queueState = {
        totalTasks: taskCount,
        currentIndex: 0,
        running: true,
        paused: false,
        successCount: 0,
        failCount: 0,
        pendingTasks: 0, // Track tasks submitted but not completed (veo3 limit: 5)
        flowMode: metadata.flowMode,
        cropMode: metadata.cropMode,
        createdAt: metadata.createdAt,
        queueId
      };

      // Preload files so content script can request without direct File access
      await this.preloadQueueFiles(taskCount, queueId);

      // Store minimal data
      await this.saveState(queueState, metadata);

      // Send start command without file data (dynamic transfer)
      const success = await this.sendToActiveTab({
        type: 'FLOW_BATCH_START',
        metadata: metadata
      });

      if (!success) {
        throw new Error('无法连接到页面脚本。请确保已在 Flow 页面打开插件。');
      }

      this.setUIState('running');
      this.addLogEntry(`队列启动成功，将处理 ${taskCount} 个任务`, 'success');

    } catch (error) {
      this.addLogEntry(`队列启动失败: ${error.message} `, 'error');
      this.setUIState('idle');
      this.showUserError(error.message);
    }
  }

  async pauseQueue() {
    try {
      const success = await this.sendToActiveTab({ type: 'FLOW_BATCH_PAUSE' });

      if (success && this.queueState) {
        this.queueState.running = false;
        this.queueState.paused = true;
        await this.saveState(this.queueState);
        this.setUIState('paused');
        this.addLogEntry('队列已暂停', 'warning');
      }
    } catch (error) {
      this.addLogEntry(`暂停失败: ${error.message} `, 'error');
    }
  }

  async clearQueue() {
    if (!confirm('确定要清空队列并终止当前任务吗？')) return;

    try {
      // CRITICAL FIX: Clear preloaded files (may fail silently if fileCacheDB doesn't exist)
      try {
        await this.clearPreloadedFiles(this.queueId);
      } catch (error) {
        this.addLogEntry(`清理文件缓存时出错: ${error.message} `, 'warning');
      }

      // Always clear memory cache
      this.preloadedFiles.clear();
      this.queueId = null;

      // Clear storage INCLUDING UI state
      await chrome.storage.local.remove([
        'flowBatchQueueState',
        'flowBatchTaskMetadata',
        'flowBatchUIState' // Also clear UI state for fresh start
      ]);

      // Send clear command
      await this.sendToActiveTab({ type: 'FLOW_BATCH_CLEAR' });

      // Reset local state
      this.queueState = null;
      this.currentFiles = [];
      this.promptInput.value = '';
      this.imageFolder.value = '';

      // Reset UI
      this.initializeUI();
      this.updatePreview();

      this.addLogEntry('队列已清空', 'success');
    } catch (error) {
      this.addLogEntry(`清空失败: ${error.message} `, 'error');
    }
  }

  // ===============================
  // UI STATE MANAGEMENT
  // ===============================

  initializeUI() {
    this.setUIState('idle');
    this.currentTask.textContent = '-';
    this.successCount.textContent = '0';
    this.failCount.textContent = '0';
    this.progressFill.style.width = '0%';
    this.folderText.textContent = '选择图片文件夹...';
    this.folderLabel.classList.remove('has-files');
  }

  setUIState(state) {
    const states = {
      idle: {
        text: '空闲',
        class: 'idle',
        startDisabled: false,
        pauseDisabled: true
      },
      preparing: {
        text: '准备中...',
        class: 'running',
        startDisabled: true,
        pauseDisabled: true
      },
      running: {
        text: '运行中',
        class: 'running',
        startDisabled: true,
        pauseDisabled: false
      },
      paused: {
        text: '已暂停',
        class: 'paused',
        startDisabled: false,
        pauseDisabled: true
      },
      error: {
        text: '错误',
        class: 'error',
        startDisabled: false,
        pauseDisabled: true
      }
    };

    const config = states[state] || states.idle;

    this.statusText.textContent = config.text;
    this.statusIndicator.className = `status-indicator ${config.class}`;
    this.startBtn.disabled = config.startDisabled;
    this.pauseBtn.disabled = config.pauseDisabled;
  }

  updateUIFromState() {
    if (!this.queueState) return;

    const { totalTasks, currentIndex, running, paused, successCount, failCount } = this.queueState;

    // Update metrics
    this.currentTask.textContent = totalTasks ? `${currentIndex + 1}/${totalTasks}` : '-';
    this.successCount.textContent = successCount || 0;
    this.failCount.textContent = failCount || 0;

    // Update progress
    const progress = totalTasks ? ((currentIndex + 1) / totalTasks * 100) : 0;
    this.progressFill.style.width = `${progress}%`;

    // Update status
    if (running && !paused) {
      this.setUIState('running');
    } else if (paused) {
      this.setUIState('paused');
    } else {
      this.setUIState('idle');
    }
  }

  handleStatusUpdate(data) {
    this.queueState = data;
    if (data && !data.running) {
      const isCompleted = data.totalTasks && data.currentIndex >= data.totalTasks;
      const hasNoPending = !data.pendingTasks || data.pendingTasks === 0;
      if (isCompleted || hasNoPending) {
        this.clearPreloadedFiles(data.queueId || this.queueId);
      }
    }
    this.updateUIFromState();
  }

  // ===============================
  // LOGGING SYSTEM
  // ===============================

  addLogEntry(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.innerHTML = `
      <span class="log-timestamp">${timestamp}</span>
      <span class="log-message ${type}">${message}</span>
    `;

    this.logContainer.appendChild(logEntry);

    // Auto-scroll to bottom
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // Limit log entries to prevent memory issues
    const entries = this.logContainer.querySelectorAll('.log-entry');
    if (entries.length > 50) {
      entries[0].remove();
    }

    console.log(`[FlowBatchPilot] ${message}`);
  }

  // ===============================
  // COMMUNICATION HELPERS
  // ===============================

  async sendToActiveTab(message, maxRetries = 3) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tabs || tabs.length === 0) {
        throw new Error('未找到当前活动标签页');
      }

      const tab = tabs[0];

      // Validate URL
      if (!tab.url || !tab.url.includes('labs.google/fx')) {
        throw new Error('请先打开 Google Labs Flow 页面 (https://labs.google/fx/tools/flow)');
      }

      // CRITICAL FIX: Ensure content script is injected
      await this.ensureContentScriptInjected(tab.id);

      // Try to send message with retries
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await this.sendMessageWithTimeout(tab.id, message, 5000);
          if (response && response.ok) {
            return true;
          } else {
            throw new Error(response?.error || '页面脚本响应错误');
          }
        } catch (attemptError) {
          if (attempt === maxRetries) {
            throw attemptError;
          }
          this.addLogEntry(`通信尝试 ${attempt}/${maxRetries} 失败，重试中...`, 'warning');
          await this.sleep(1000 * attempt); // Exponential backoff
        }
      }

    } catch (error) {
      this.addLogEntry(`通信失败: ${error.message}`, 'error');
      throw error;
    }
  }

  // Ensure content script is injected
  async ensureContentScriptInjected(tabId) {
    try {
      // First try to ping the content script
      const pingResponse = await this.sendMessageWithTimeout(tabId, { type: 'PING' }, 2000);
      if (pingResponse && pingResponse.loaded) {
        this.addLogEntry('Content script 已加载', 'success');
        return true;
      }
    } catch (error) {
      this.addLogEntry('Content script 未加载，尝试注入...', 'warning');
    }

    // Inject content script dynamically
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });

      this.addLogEntry('Content script 注入成功', 'success');

      // Wait for script to initialize
      await this.sleep(1000);

      // Verify injection was successful
      const verifyResponse = await this.sendMessageWithTimeout(tabId, { type: 'PING' }, 3000);
      if (verifyResponse && verifyResponse.loaded) {
        this.addLogEntry('Content script 初始化完成', 'success');
        return true;
      } else {
        throw new Error('Content script 注入后无法验证');
      }

    } catch (injectError) {
      this.addLogEntry(`Content script 注入失败: ${injectError.message}`, 'error');
      throw new Error(`无法注入页面脚本。请确保：\n1. 已在 Flow 页面刷新页面\n2. 扩展有足够权限\n\n技术详情：${injectError.message}`);
    }
  }

  // Send message with timeout
  async sendMessageWithTimeout(tabId, message, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('消息发送超时'));
      }, timeout);

      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Simple sleep utility
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===============================
  // ERROR HANDLING
  // ===============================

  async testConnection() {
    this.testConnectionBtn.disabled = true;
    this.testConnectionBtn.textContent = '测试中...';

    try {
      this.addLogEntry('开始连接测试...', 'info');

      // Step 1: Check current tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) {
        throw new Error('未找到当前活动标签页');
      }

      const tab = tabs[0];
      this.addLogEntry(`当前页面: ${tab.url}`, 'info');

      // Step 2: Validate URL
      if (!tab.url || !tab.url.includes('labs.google/fx')) {
        throw new Error('请在 Google Labs Flow 页面使用此插件');
      }

      // Step 3: Ensure content script is loaded
      await this.ensureContentScriptInjected(tab.id);

      // Step 4: Test communication
      const pingResponse = await this.sendMessageWithTimeout(tab.id, { type: 'PING' }, 3000);

      if (pingResponse && pingResponse.loaded) {
        this.addLogEntry('✅ 连接测试成功！', 'success');
        this.testConnectionBtn.textContent = '✅ 连接正常';
        this.testConnectionBtn.style.background = 'var(--secondary)';
      } else {
        throw new Error('Content script 响应异常');
      }

    } catch (error) {
      this.addLogEntry(`❌ 连接测试失败: ${error.message}`, 'error');
      this.testConnectionBtn.textContent = '❌ 连接失败';
      this.testConnectionBtn.style.background = 'var(--error)';
      this.showUserError(error.message);
    }

    // Reset button after 3 seconds
    setTimeout(() => {
      this.testConnectionBtn.disabled = false;
      this.testConnectionBtn.textContent = '测试连接';
      this.testConnectionBtn.style.background = '';
      this.testConnectionBtn.style.borderColor = '';
    }, 3000);
  }

  showUserError(message) {
    // Enhanced error handling with specific guidance
    let guidance = '';

    if (message.includes('Receiving end does not exist') ||
      message.includes('content script') ||
      message.includes('通信失败')) {
      guidance = `
        <div style="margin-top: 12px; padding: 12px; background: rgba(255, 255, 255, 0.1); border-radius: 6px; font-size: 12px;">
          <strong>解决步骤：</strong><br>
          1️⃣ 确保在 <strong>https://labs.google/fx/tools/flow</strong> 页面<br>
          2️⃣ 刷新页面（F5 或 Ctrl+R）<br>
          3️⃣ 等待页面完全加载后再重试<br>
          4️⃣ 确保扩展有足够的权限
        </div>
      `;
    } else if (message.includes('请先打开')) {
      guidance = `
        <div style="margin-top: 12px; padding: 12px; background: rgba(255, 255, 255, 0.1); border-radius: 6px; font-size: 12px;">
          <strong>请在以下页面使用插件：</strong><br>
          • https://labs.google/fx/tools/flow<br>
          • 页面必须完全加载完成
        </div>
      `;
    }

    // Create user-friendly error dialog
    const errorDialog = document.createElement('div');
    errorDialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(135deg, #2c2c2e, #1c1c1e);
      border: 2px solid var(--error);
      border-radius: 12px;
      padding: 24px;
      color: var(--text-primary);
      z-index: 10000;
      max-width: 380px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      font-family: 'Inter', -apple-system, sans-serif;
    `;

    errorDialog.innerHTML = `
      <div style="display: flex; align-items: center; margin-bottom: 16px;">
        <div style="width: 24px; height: 24px; background: var(--error); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
          <span style="color: white; font-size: 16px; font-weight: bold;">!</span>
        </div>
        <h3 style="color: var(--error); margin: 0; font-size: 18px; font-weight: 600;">连接失败</h3>
      </div>

      <div style="background: rgba(255, 59, 48, 0.1); border-left: 4px solid var(--error); padding: 12px; margin-bottom: 16px; border-radius: 4px;">
        <p style="margin: 0; font-size: 13px; line-height: 1.4;">${message}</p>
      </div>

      ${guidance}

      <div style="display: flex; gap: 8px; margin-top: 20px;">
        <button onclick="this.parentElement.parentElement.remove()" style="
          background: var(--error);
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          flex: 1;
        ">关闭</button>
        <button onclick="window.location.reload()" style="
          background: var(--primary);
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          flex: 1;
        ">刷新页面</button>
      </div>
    `;

    document.body.appendChild(errorDialog);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (errorDialog.parentElement) {
        errorDialog.remove();
      }
    }, 10000);
  }
}

// ===============================
// INITIALIZATION
// ===============================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize the application
  window.flowBatchPilot = new FlowBatchPilot();

  // Add global error handler
  window.addEventListener('error', (event) => {
    console.error('[FlowBatchPilot] Global error:', event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[FlowBatchPilot] Unhandled promise rejection:', event.reason);
  });
});
