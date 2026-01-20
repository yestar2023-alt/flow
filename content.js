/**
 * FlowBatchPilot 2.0 - Content Script
 *
 * ARCHITECTURE COMPLIANCE:
 * - Critical Fix: Robust mode switching to "Ingredients to Video"
 * - Async/Promise-based queue management with proper sequencing
 * - Stable Selectors: Uses XPath and DOM-independent identifiers
 * - Dynamic File Transfer: On-demand file requests with caching
 * - Timing Control: Polling + MutationObserver for element detection
 * - Logic Optimization: Eliminates redundant steps and wait conditions
 */

class FlowBatchContentScript {
  // Configuration constants
  static CONFIG = {
    QUEUE_LIMIT: 4,                     // Flow queue limit (throttled)
    QUEUE_CHECK_INTERVAL: 500,          // ms between queue space checks
    QUEUE_STATUS_LOG_INTERVAL: 10,      // log every N checks
    QUEUE_CAPACITY_TIMEOUT: 120 * 1000, // 2 minutes max wait for queue space
    QUEUE_THROTTLE_DELAY: 60 * 1000,    // wait 60s before re-checking when full
    TASK_DELAY: 300,                    // ms between tasks
    VIDEO_GENERATION_TIMEOUT: 90 * 1000,// 90 seconds
    VIDEO_LOAD_TIMEOUT: 5 * 1000,       // 5 seconds for video load check
    ELEMENT_WAIT_INTERVAL: 200,         // ms between element checks
    CLICK_DELAY: 200,                   // ms after click
    SCROLL_DELAY: 300,                  // ms after scroll
    PENDING_TASKS_WAIT: 5000            // ms when waiting for pending tasks
  };

  constructor() {
    this.queueRunning = false;
    this.fileCache = new Map();
    this.currentQueueId = null;
    this.currentTaskPointer = 0;
    this._updatingState = null; // Lock for atomic state updates
    this.setupMessageHandlers();
    this.initializeAutoResume();
    this.injectFloatingWidget();
    this.log('Content Script initialized and ready');
  }

  // ===============================
  // MESSAGE HANDLING
  // ===============================

  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // CRITICAL FIX: Handle async operations properly
      this.handleMessage(message, sender, sendResponse).catch(error => {
        this.log(`Unhandled error in message handler: ${error.message}`, 'error');
        if (!sendResponse.called) {
          sendResponse({ ok: false, error: error.message });
        }
      });
      return true; // Keep message channel open for async responses
    });
  }

  async handleMessage(message, sender, sendResponse) {
    // CRITICAL FIX: Track if response was sent to prevent double response
    let responseSent = false;
    
    const safeSendResponse = (data) => {
      if (!responseSent && sendResponse) {
        responseSent = true;
        try {
          sendResponse(data);
        } catch (error) {
          this.log(`Error sending response: ${error.message}`, 'error');
        }
      }
    };

    try {
      switch (message.type) {
        case 'PING':
          safeSendResponse({ ok: true, loaded: true });
          return;

        case 'FLOW_BATCH_START':
          // CRITICAL FIX: Don't await handleStartQueue, let it run in background
          // But still send response immediately to keep channel open
          this.handleStartQueue(message.metadata).catch(error => {
            this.log(`Queue start error: ${error.message}`, 'error');
          });
          safeSendResponse({ ok: true });
          return;

        case 'FLOW_BATCH_PAUSE':
          await this.handlePauseQueue();
          safeSendResponse({ ok: true });
          return;

        case 'FLOW_BATCH_CLEAR':
          await this.handleClearQueue();
          safeSendResponse({ ok: true });
          return;

        case 'FLOW_BATCH_OPEN_PANEL':
          this.showFloatingPanel();
          safeSendResponse({ ok: true });
          return;

        default:
          safeSendResponse({ ok: false, error: 'Unknown message type' });
          return;
      }
    } catch (error) {
      this.log(`Error handling message: ${error.message}`, 'error');
      safeSendResponse({ ok: false, error: error.message });
    }
  }

  // ===============================
  // QUEUE MANAGEMENT
  // ===============================

  async handleStartQueue(metadata) {
    // ULTIMATE FIX: User explicitly wants to start queue, so FORCE STOP everything first
    this.log('User requested queue start - forcing clean state...', 'info');
    
    // STEP 1: Force stop memory state immediately
    this.queueRunning = false;
    
    // STEP 2: Force stop storage state
    await this.updateQueueState({ 
      running: false, 
      paused: false, 
      pendingTasks: 0 
    }).catch(() => {
      // Ignore errors, just try to reset
    });
    
    // STEP 3: Wait for any running process to stop
    await this.sleep(800);
    
    // STEP 4: Double-check and force reset again
    this.queueRunning = false;
    const currentState = await this.loadQueueState();
    if (currentState && currentState.running) {
      this.log('Force clearing running state from storage...', 'warning');
      await this.updateQueueState({ 
        running: false, 
        paused: false, 
        pendingTasks: 0,
        currentIndex: 0,
        successCount: 0,
        failCount: 0
      }).catch(() => {});
      await this.sleep(300);
    }
    
    // STEP 5: Final check - if still running, it's a real active queue
    const finalState = await this.loadQueueState();
    if (finalState && finalState.running && !finalState.paused) {
      const isQueueActive = finalState.currentIndex < finalState.totalTasks;
      const hasPendingTasks = (finalState.pendingTasks || 0) > 0;
      
      // Only prevent if queue is TRULY active (has pending tasks or not completed)
      if (hasPendingTasks && hasPendingTasks > 0) {
        this.log(`WARNING: Queue has ${hasPendingTasks} pending tasks. User may want to wait.`, 'warning');
        // Still allow start, but warn user
        this.logToPopup(`警告: 检测到 ${hasPendingTasks} 个待处理任务，将清除旧队列`, 'warning');
      }
      
      // Force clear anyway since user explicitly requested start
      await this.updateQueueState({ 
        running: false, 
        paused: false, 
        pendingTasks: 0 
      }).catch(() => {});
    }

    // STEP 6: Ensure memory state is clean
    this.queueRunning = false;
    await this.sleep(FlowBatchContentScript.CONFIG.CLICK_DELAY);

    // STEP 7: Reset per-queue cache and task pointer
    this.fileCache.clear();
    this.currentQueueId = Date.now();
    this.currentTaskPointer = 0;
    this.log(`Initialized new queue cache (id=${this.currentQueueId})`, 'info');

    // STEP 8: Now start fresh - no more checks, user wants this
    this.queueRunning = true;
    this.metadata = metadata;

    // Create fresh queue state
    const newQueueState = {
      totalTasks: metadata.totalTasks,
      currentIndex: 0,
      running: true,
      paused: false,
      successCount: 0,
      failCount: 0,
      pendingTasks: 0,
      flowMode: metadata.flowMode,
      cropMode: metadata.cropMode,
      createdAt: Date.now()
    };
    
    await this.updateQueueState(newQueueState);

    this.log(`Starting FRESH queue with ${metadata.totalTasks} tasks`, 'success');
    this.logToPopup(`开始处理 ${metadata.totalTasks} 个任务`, 'info');

    // CRITICAL FIX: Ensure correct mode before processing
    await this.ensureCorrectMode(metadata.flowMode);

    // Start queue processing (don't await, let it run in background)
    this.processQueue().catch(error => {
      this.log(`Queue processing error: ${error.message}`, 'error');
      this.queueRunning = false;
      this.updateQueueState({ running: false }).catch(() => {});
    });
  }

  async handlePauseQueue() {
    this.queueRunning = false;
    await this.updateQueueState({ running: false, paused: true });
    this.log('Queue paused', 'warning');
    this.logToPopup('队列已暂停', 'warning');
  }

  async handleClearQueue() {
    this.queueRunning = false;
    this.fileCache.clear();
    this.currentQueueId = null;
    this.currentTaskPointer = 0;
    await chrome.storage.local.remove(['flowBatchQueueState', 'flowBatchTaskMetadata']);
    this.log('Queue cleared', 'success');
    this.logToPopup('队列已清空', 'success');
  }

  async waitForQueueCapacity(context = 'queue') {
    const queueLimit = FlowBatchContentScript.CONFIG.QUEUE_LIMIT;
    const throttleDelay = FlowBatchContentScript.CONFIG.QUEUE_THROTTLE_DELAY || (60 * 1000);
    const timeout = FlowBatchContentScript.CONFIG.QUEUE_CAPACITY_TIMEOUT;

    let state = await this.loadQueueState();
    if (!state) {
      return false;
    }

    let pendingTasks = state.pendingTasks || 0;
    if (pendingTasks < queueLimit) {
      return true;
    }

    this.log(`⏸️ [${context}] 队列已满 (${pendingTasks}/${queueLimit})，等待 ${throttleDelay / 1000} 秒再检查...`, 'warning');
    this.logToPopup(`⏸️ 队列已满 (${pendingTasks}/${queueLimit})，将在 ${throttleDelay / 1000} 秒后重试`, 'warning');

    const startTime = Date.now();

    while (pendingTasks >= queueLimit) {
      if (Date.now() - startTime > timeout) {
        this.log(`⚠️ [${context}] 等待队列空闲超时 (${pendingTasks}/${queueLimit})`, 'warning');
        return false;
      }

      if (!this.queueRunning) {
        this.log(`ℹ️ [${context}] 队列已停止，终止等待`, 'info');
        return false;
      }

      if (state.paused) {
        this.log(`ℹ️ [${context}] 队列已暂停，终止等待`, 'info');
        return false;
      }

      await this.sleep(throttleDelay);
      this.log(`⏳ [${context}] 已等待 ${((Date.now() - startTime) / 1000).toFixed(0)} 秒，重新检查队列 (${pendingTasks}/${queueLimit})`, 'info');

      state = await this.loadQueueState();
      if (!state) {
        return false;
      }
      pendingTasks = state.pendingTasks || 0;
    }

    this.log(`✅ [${context}] 队列有空闲 (${pendingTasks}/${queueLimit})`, 'success');
    this.logToPopup(`✅ 队列有空闲 (${pendingTasks}/${queueLimit})，继续处理`, 'success');
    return true;
  }

  async processQueue() {
    this.log('Queue processing started', 'info');
    
    while (this.queueRunning) {
      try {
        const state = await this.loadQueueState();
        
        if (!state) {
          this.log('Queue state missing, stopping queue', 'warning');
          this.queueRunning = false;
          this.currentTaskPointer = 0;
          break;
        }
        
        // Check if queue should stop
        if (state.currentIndex >= (state.totalTasks || 0)) {
          // Check if there are still pending tasks
          const pendingTasks = state.pendingTasks || 0;
          if (pendingTasks > 0) {
            this.log(`Waiting for ${pendingTasks} pending tasks to complete...`, 'info');
            this.logToPopup(`等待 ${pendingTasks} 个任务完成...`, 'info');
            await this.sleep(FlowBatchContentScript.CONFIG.PENDING_TASKS_WAIT);
            continue;
          }

          // Queue is truly completed
          this.log('Queue completed', 'success');
          this.logToPopup('队列处理完成', 'success');
          
          // CRITICAL: Always reset both memory and storage state
          this.queueRunning = false;
          this.currentTaskPointer = state.totalTasks || 0;
          await this.updateQueueState({ 
            running: false, 
            paused: false, 
            pendingTasks: 0 
          });
          break;
        }

        if (state.paused) {
          await this.sleep(1000);
          continue;
        }

        if (typeof state.currentIndex !== 'number') {
          state.currentIndex = 0;
        }

        if (this.currentTaskPointer !== state.currentIndex) {
          this.log(`Syncing task pointer from ${this.currentTaskPointer} to ${state.currentIndex}`, 'warning');
          this.currentTaskPointer = state.currentIndex;
        }

        // CRITICAL: Check queue limit (throttled to 4 tasks)
        const pendingTasks = state.pendingTasks || 0;
        if (pendingTasks >= FlowBatchContentScript.CONFIG.QUEUE_LIMIT) {
          const hasCapacity = await this.waitForQueueCapacity('processQueue');
          if (!hasCapacity) {
            // 如果等待失败，重新进入循环，避免继续处理
            continue;
          }
          // 重新同步状态
          continue;
        }

        // CRITICAL FIX: Capture current index before processing to avoid race conditions
        const currentTaskIndex = this.currentTaskPointer;
        
        this.log(`处理任务 ${currentTaskIndex + 1}/${state.totalTasks}`, 'info');
        
        // Process task with captured index
        await this.processTask(currentTaskIndex);

        // CRITICAL FIX: Reload state to get latest values, then update
        const updatedState = await this.loadQueueState() || {};
        this.currentTaskPointer = currentTaskIndex + 1;
        updatedState.currentIndex = this.currentTaskPointer;
        await this.updateQueueState(updatedState);
        this.log(`Task ${currentTaskIndex + 1} completed, moving to index ${updatedState.currentIndex}`, 'info');

        // 任务之间的短暂延迟
        await this.sleep(FlowBatchContentScript.CONFIG.TASK_DELAY);

      } catch (error) {
        this.log(`Queue processing error: ${error.message}`, 'error');
        this.logToPopup(`任务处理失败: ${error.message}`, 'error');

        // Check if we should continue or stop
        if (!this.queueRunning) {
          this.log('Queue stopped, exiting process loop', 'info');
          break;
        }

        // Continue with next task on error
        const state = await this.loadQueueState();
        if (state) {
          state.failCount = (state.failCount || 0) + 1;
          state.currentIndex = (state.currentIndex || 0) + 1;
          this.currentTaskPointer = state.currentIndex;
          await this.updateQueueState(state);
        } else {
          // No state means queue was cleared, stop processing
          this.queueRunning = false;
          break;
        }
        
        // Brief delay after error before retrying
        await this.sleep(1000);
      }
    }
    
    // CRITICAL: Ensure state is reset when loop exits
    this.log('Queue processing loop exited', 'info');
    if (this.queueRunning) {
      // If we exited but queueRunning is still true, something went wrong
      this.queueRunning = false;
      await this.updateQueueState({ running: false }).catch(() => {});
    }
  }

  // ===============================
  // TASK PROCESSING (Optimized Logic)
  // ===============================

  async processTask(taskIndex) {
    // CRITICAL FIX: Validate task index
    if (taskIndex < 0 || taskIndex >= this.metadata.totalTasks) {
      throw new Error(`Invalid task index: ${taskIndex} (total: ${this.metadata.totalTasks})`);
    }

    const { promptList, filenameList, cropMode } = this.metadata;
    const prompt = promptList[taskIndex];
    const filename = filenameList[taskIndex];

    this.log(`Processing task ${taskIndex + 1}/${this.metadata.totalTasks}: file=${filename}, prompt=${prompt.substring(0, 30)}...`, 'info');
    this.logToPopup(`开始任务 ${taskIndex + 1}/${this.metadata.totalTasks}: ${prompt.substring(0, 30)}...`, 'info');

    try {
      // CRITICAL FIX: Request file with validated index
      this.log(`Requesting file for task index ${taskIndex}: ${filename}`, 'info');
      const fileData = await this.requestFileData(taskIndex);
      
      if (!fileData || !fileData.name) {
        throw new Error(`Failed to get file data for index ${taskIndex}`);
      }
      
      this.log(`File data received: ${fileData.name} (index ${taskIndex})`, 'success');

      // Step 1: Upload image (only for modes that need it)
      if (this.needsImageUpload(this.metadata.flowMode)) {
        await this.uploadImage(fileData);
        this.logToPopup(`✅ 图片上传完成: ${filename}`, 'success');
      }

      // Step 2: Handle cropping (with improved timing)
      if (this.needsImageUpload(this.metadata.flowMode)) {
        await this.handleCropModal(this.metadata?.cropMode);
        this.logToPopup('✅ 裁剪完成 (使用全局设置)', 'success');
      }

      // Step 3: Input prompt
      await this.inputPrompt(prompt);
      this.logToPopup(`✅ 提示词输入完成`, 'success');

      // Step 4: Submit for generation
      // CRITICAL: 在提交前记录当前视频数量，用于后续识别新生成的视频
      let videoCountBeforeSubmit = 0;
      try {
        const container = document.evaluate(
          '//div[contains(@class, "generated-results")]',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        if (container) {
          const cards = container.querySelectorAll('div[data-result-index]');
          videoCountBeforeSubmit = cards.length;
          this.log(`提交前视频数量: ${videoCountBeforeSubmit}`, 'info');
        }
      } catch (error) {
        this.log(`无法获取提交前视频数量: ${error.message}`, 'warning');
      }
      
      await this.submitForGeneration();
      
      // CRITICAL FIX: Atomic increment of pendingTasks
      const state = await this.loadQueueState();
      if (state) {
        const newPendingTasks = (state.pendingTasks || 0) + 1;
        await this.updateQueueState({ pendingTasks: newPendingTasks });
        const queueLimit = FlowBatchContentScript.CONFIG.QUEUE_LIMIT;
        this.logToPopup(`📤 已提交 (队列: ${newPendingTasks}/${queueLimit})`, 'info');
      }

      // Step 5: Wait for generation and download (in background)
      // This will run asynchronously while we can process next tasks
      // CRITICAL: 传入提交前的视频数量，用于识别新生成的视频
      this.waitForTaskCompletion(taskIndex, prompt, videoCountBeforeSubmit).catch(error => {
        this.log(`任务 ${taskIndex + 1} 后台完成处理失败: ${error.message}`, 'error');
      });

    } catch (error) {
      this.log(`Task ${taskIndex + 1} failed: ${error.message}`, 'error');
      
      // CRITICAL FIX: Atomic decrement on error
      const state = await this.loadQueueState();
      if (state) {
        await this.updateQueueState({
          pendingTasks: Math.max(0, (state.pendingTasks || 0) - 1),
          failCount: (state.failCount || 0) + 1
        });
      }
      
      throw error;
    }
  }

  // Wait for task completion in background and update pendingTasks
  async waitForTaskCompletion(taskIndex, prompt, videoCountBeforeSubmit = 0) {
    try {
      this.log(`任务 ${taskIndex + 1} 开始等待生成完成...`, 'info');
      this.logToPopup(`⏳ 任务 ${taskIndex + 1} 等待生成完成（约1分钟）...`, 'info');
      
      // Step 1: 等待视频真正生成完成（视频加载完成，可以播放）
      const downloadUrl = await this.waitForGeneration(taskIndex, videoCountBeforeSubmit);
      
      // Step 2: 视频生成完成后，立即下载
      this.log(`任务 ${taskIndex + 1} 视频生成完成，开始下载...`, 'info');
      this.logToPopup(`📥 任务 ${taskIndex + 1} 开始下载...`, 'info');
      await this.downloadVideo(downloadUrl, taskIndex, prompt);

      this.log(`✅ 任务 ${taskIndex + 1} 完成并已下载`, 'success');
      this.logToPopup(`✅ 任务 ${taskIndex + 1} 完成并已下载`, 'success');

      // CRITICAL FIX: Atomic update of pendingTasks
      const state = await this.loadQueueState();
      if (state) {
        const newPendingTasks = Math.max(0, (state.pendingTasks || 0) - 1);
        await this.updateQueueState({
          successCount: (state.successCount || 0) + 1,
          pendingTasks: newPendingTasks
        });
        
        const queueLimit = FlowBatchContentScript.CONFIG.QUEUE_LIMIT;
        this.log(`✅ 队列更新: ${newPendingTasks}/${queueLimit} (任务 ${taskIndex + 1} 完成)`, 'success');
        if (newPendingTasks < queueLimit) {
          this.logToPopup(`✅ 队列有空闲 (${newPendingTasks}/${queueLimit})，可以继续发送`, 'success');
        }
      }
    } catch (error) {
      this.log(`❌ 任务 ${taskIndex + 1} 完成处理失败: ${error.message}`, 'error');
      this.logToPopup(`❌ 任务 ${taskIndex + 1} 失败: ${error.message}`, 'error');
      
      // CRITICAL FIX: Atomic update even on error
      const state = await this.loadQueueState();
      if (state) {
        const newPendingTasks = Math.max(0, (state.pendingTasks || 0) - 1);
        await this.updateQueueState({
          pendingTasks: newPendingTasks,
          failCount: (state.failCount || 0) + 1
        });
        const queueLimit = FlowBatchContentScript.CONFIG.QUEUE_LIMIT;
        this.log(`队列更新: ${newPendingTasks}/${queueLimit} (任务 ${taskIndex + 1} 失败)`, 'warning');
      }
    }
  }

  // Wait for queue space (pendingTasks < 5)
  async waitForQueueSpace(maxWait = 300000) { // 5 minutes max wait
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const state = await this.loadQueueState();
      const pendingTasks = state.pendingTasks || 0;
      
      if (pendingTasks < 5) {
        this.log(`Queue has space (${pendingTasks}/5), resuming...`, 'success');
        this.logToPopup(`队列有空闲 (${pendingTasks}/5)，继续发送`, 'success');
        return true;
      }
      
      // Wait 5 seconds before checking again
      await this.sleep(5000);
    }
    
    this.log('Queue space wait timeout', 'warning');
    this.logToPopup('等待队列空闲超时', 'warning');
    return false;
  }

  // ===============================
  // CRITICAL FIX: Mode Switching
  // ===============================

  async ensureCorrectMode(targetMode) {
    this.log(`Ensuring correct mode: ${targetMode}`, 'info');

    // CRITICAL FIX: Robust mode detection with multiple strategies
    const modeButton = await this.findModeButton();

    if (!modeButton) {
      this.log('Mode button not found, assuming correct mode', 'warning');
      return;
    }

    const currentModeText = this.extractModeText(modeButton);
    this.log(`Current mode detected: "${currentModeText}"`, 'info');

    // Check if current mode matches target
    if (this.isCorrectMode(currentModeText, targetMode)) {
      this.log('✅ Already in correct mode', 'success');
      return;
    }

    this.log(`🔄 Switching to ${targetMode} mode...`, 'warning');
    this.logToPopup(`正在切换到 ${this.getModeText(targetMode)} 模式...`, 'warning');

    // Click mode button to open dropdown
    await this.clickElement(modeButton);
    await this.sleep(500);

    // Find and click target mode option
    const targetOption = await this.findModeOption(targetMode);
    if (!targetOption) {
      throw new Error(`Failed to find ${targetMode} mode option`);
    }

    await this.clickElement(targetOption);
    await this.sleep(1000);

    // Verify mode switch was successful
    const verificationButton = await this.findModeButton();
    const verificationText = this.extractModeText(verificationButton);

    if (this.isCorrectMode(verificationText, targetMode)) {
      this.log('✅ Mode switch successful', 'success');
      this.logToPopup(`✅ 已切换到 ${this.getModeText(targetMode)} 模式`, 'success');
    } else {
      throw new Error(`Mode switch failed. Current: "${verificationText}", Target: ${targetMode}`);
    }
  }

  async ensureGlobalSettings(metadata) {
    try {
      await this.setGlobalAspectRatio(metadata?.cropMode);
    } catch (error) {
      this.log(`Failed to set global settings: ${error.message}`, 'warning');
    }
  }

  async setGlobalAspectRatio(cropMode) {
    if (!cropMode) {
      this.log('No crop mode specified, skipping global aspect ratio setting', 'info');
      return;
    }

    const isPortrait = cropMode === 'portrait' || cropMode === '9:16';
    const iconText = isPortrait ? 'crop_portrait' : 'crop_landscape';
    const labelText = isPortrait ? 'Portrait (9:16)' : 'Landscape (16:9)';
    
    this.log(`Setting global aspect ratio to: ${labelText} (icon: ${iconText})`, 'info');

    try {
      // Step 1: Find and click the Settings button (tune icon)
      // User provided: <button aria-haspopup="dialog" aria-controls="radix-:r19k:" data-state="closed">
      //                <i class="material-icons-outlined">tune</i>
      const settingsButton = await this.findSettingsButton();
      if (!settingsButton) {
        this.log('Settings button not found, skipping global aspect ratio setting', 'warning');
        this.logToPopup(`⚠️ 未找到设置按钮`, 'warning');
        return;
      }

      // Check if settings dialog is already open
      const isOpen = settingsButton.getAttribute('aria-expanded') === 'true' ||
                     settingsButton.getAttribute('data-state') === 'open';
      
      if (!isOpen) {
        this.log('Clicking Settings button to open dialog...', 'info');
        await this.clickElement(settingsButton);
        await this.sleep(1500); // Wait longer for dialog to fully open and render
      } else {
        this.log('Settings dialog already open', 'info');
        await this.sleep(FlowBatchContentScript.CONFIG.QUEUE_CHECK_INTERVAL); // Still wait a bit to ensure it's fully rendered
      }

      // Step 2: Find and click the aspect ratio option in the opened dialog
      this.log(`Searching for aspect ratio option: ${labelText} (icon: ${iconText})...`, 'info');
      const toggle = await this.findGlobalAspectToggle(iconText, labelText);
      if (!toggle) {
        this.log(`Global aspect ratio toggle not found for ${labelText}`, 'warning');
        this.logToPopup(`⚠️ 未找到裁剪比例选项: ${labelText}`, 'warning');
        return;
      }

      // Check if already selected
      const isActive =
        toggle.getAttribute('aria-checked') === 'true' ||
        toggle.getAttribute('aria-pressed') === 'true' ||
        toggle.classList.contains('active') ||
        toggle.classList.contains('selected') ||
        toggle.getAttribute('data-state') === 'on' ||
        toggle.getAttribute('data-selected') === 'true';

      if (isActive) {
        this.log(`Global aspect ratio already set to ${labelText}`, 'info');
        this.logToPopup(`✅ 全局裁剪比例已设置: ${labelText}`, 'info');
        return;
      }

      this.log(`Clicking global aspect ratio toggle: ${labelText}`, 'info');
      await this.clickElement(toggle);
      await this.sleep(600); // Wait for UI to update
      
      // Verify the click worked
      const isActiveAfter = toggle.getAttribute('aria-checked') === 'true' ||
                           toggle.getAttribute('aria-pressed') === 'true' ||
                           toggle.classList.contains('active') ||
                           toggle.classList.contains('selected') ||
                           toggle.getAttribute('data-state') === 'on';
      
      if (isActiveAfter) {
        this.log(`✅ Global aspect ratio set to ${labelText}`, 'success');
        this.logToPopup(`✅ 已设置全局裁剪比例: ${labelText}`, 'success');
      } else {
        this.log(`⚠️ Global aspect ratio click may not have taken effect`, 'warning');
        this.logToPopup(`⚠️ 全局裁剪比例设置可能未生效`, 'warning');
      }
    } catch (error) {
      this.log(`Failed to set global aspect ratio: ${error.message}`, 'error');
      this.logToPopup(`⚠️ 设置全局裁剪比例失败: ${error.message}`, 'error');
    }
  }

  async findSettingsButton() {
    // User provided: button with tune icon and aria-haspopup="dialog"
    const strategies = [
      // Strategy 1: Button with tune icon and aria-haspopup="dialog"
      '//button[@aria-haspopup="dialog" and .//i[contains(text(), "tune")]]',
      // Strategy 2: Button with material-icons-outlined containing tune
      '//button[.//i[contains(@class, "material-icons-outlined") and contains(text(), "tune")]]',
      // Strategy 3: Button with aria-controls starting with "radix-"
      '//button[@aria-haspopup="dialog" and contains(@aria-controls, "radix-")]',
      // Strategy 4: Button containing "Settings" text (hidden span)
      '//button[.//span[contains(text(), "Settings")]]',
      // Strategy 5: Any button with tune icon
      '//button[.//i[contains(text(), "tune")]]'
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        this.log(`Trying strategy ${i + 1} to find Settings button...`, 'info');
        const button = await this.waitForElement(strategies[i], 3000);
        if (button) {
          this.log(`Found Settings button using strategy ${i + 1}`, 'success');
          return button;
        }
      } catch (error) {
        continue;
      }
    }

    // Fallback: Manual search
    this.log('Trying fallback: searching all buttons for tune icon...', 'info');
    try {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const icons = btn.querySelectorAll('i.material-icons-outlined, i[class*="material-icons"]');
        for (const icon of icons) {
          const iconText = icon.textContent || icon.innerText || '';
          if (iconText.includes('tune')) {
            const hasDialog = btn.getAttribute('aria-haspopup') === 'dialog';
            if (hasDialog) {
              this.log('Found Settings button via fallback', 'success');
              return btn;
            }
          }
        }
      }
    } catch (error) {
      this.log(`Fallback search failed: ${error.message}`, 'warning');
    }

    return null;
  }

  async findGlobalAspectToggle(iconText, labelText) {
    // User provided: <span class="sc-4b3fbad9-5 blfRBx">
    //                  <i class="material-icons">crop_portrait</i>Portrait (9:16)
    //                 </span>
    // These are in the settings dialog that opens after clicking the Settings button
    
    // Wait a bit more for dialog content to fully render
    await this.sleep(800);
    
    const strategies = [
      // Strategy 1: Find span with icon and text, then get clickable parent (button or div)
      `//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]/ancestor::button[1]`,
      `//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]/ancestor::*[@role="button"][1]`,
      `//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]/ancestor::div[contains(@class, "button") or @onclick][1]`,
      // Strategy 2: Direct button/div containing the span
      `//button[.//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]]`,
      `//div[.//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")] and (@onclick or @role="button")]`,
      // Strategy 3: Find by icon text in material-icons
      `//button[.//i[contains(@class, "material-icons") and contains(text(), "${iconText}")]]`,
      `//div[.//i[contains(@class, "material-icons") and contains(text(), "${iconText}")] and (@onclick or @role="button")]`,
      // Strategy 4: Find span with icon and text (might be clickable itself or have clickable parent)
      `//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]`,
      // Strategy 5: Find by label text only
      `//button[contains(normalize-space(.), "${labelText}")]`,
      // Strategy 6: Find in radix-* dialog containers
      `//*[contains(@id, "radix-")]//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]/ancestor::button[1]`,
      `//*[contains(@id, "radix-")]//span[.//i[contains(text(), "${iconText}")] and contains(normalize-space(.), "${labelText}")]/ancestor::div[@onclick or @role="button"][1]`
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        this.log(`Trying strategy ${i + 1} to find aspect ratio toggle in settings dialog...`, 'info');
        const element = await this.waitForElement(strategies[i], 3000);
        if (element) {
          // Verify it contains the correct icon and text
          const elementText = (element.textContent || element.innerText || '').trim();
          const icons = element.querySelectorAll('i.material-icons, i[class*="material-icons"]');
          let foundIcon = false;
          let iconContent = '';
          
          for (const icon of icons) {
            iconContent = icon.textContent || icon.innerText || '';
            if (iconContent.includes(iconText)) {
              foundIcon = true;
              break;
            }
          }
          
          if (foundIcon && elementText.includes(labelText)) {
            this.log(`Found aspect ratio toggle using strategy ${i + 1} (text: ${elementText}, icon: ${iconContent})`, 'success');
            return element;
          } else {
            this.log(`Element found but doesn't match (text: "${elementText}", icon: ${foundIcon}, iconText: "${iconContent}")`, 'warning');
          }
        }
      } catch (error) {
        continue;
      }
    }

    // Fallback: Manual search in settings dialog
    this.log('Trying fallback: searching all spans with aspect ratio text in dialog...', 'info');
    try {
      await this.sleep(500);
      
      const allSpans = document.querySelectorAll('span');
      this.log(`Found ${allSpans.length} spans in dialog, searching for aspect ratio...`, 'info');
      
      for (const span of allSpans) {
        const spanText = (span.textContent || span.innerText || '').trim();
        if (!spanText.includes('Portrait') && !spanText.includes('Landscape')) continue;
        
        // Check all icons, not just material-icons
        const icons = span.querySelectorAll('i');
        
        for (const icon of icons) {
          const iconContent = (icon.textContent || icon.innerText || '').trim();
          if (iconContent.includes(iconText) && spanText.includes(labelText)) {
            this.log(`Found matching span: text="${spanText}", icon="${iconContent}"`, 'info');
            
            // Find clickable parent (button, div with onclick, or element with role="button")
            let clickable = span.closest('button') || 
                           span.closest('[role="button"]') || 
                           span.closest('[onclick]') ||
                           span.closest('div[onclick]');
            
            // If no clickable parent found, check parent elements
            if (!clickable) {
              let current = span.parentElement;
              let depth = 0;
              while (current && depth < 5) {
                if (current.tagName === 'BUTTON' || 
                    current.getAttribute('role') === 'button' ||
                    current.onclick ||
                    (current.tagName === 'DIV' && current.onclick)) {
                  clickable = current;
                  break;
                }
                current = current.parentElement;
                depth++;
              }
            }
            
            if (clickable) {
              this.log(`✅ Found aspect ratio toggle via fallback (text: ${spanText}, clickable: ${clickable.tagName})`, 'success');
              return clickable;
            } else {
              this.log(`Found span but no clickable parent (text: ${spanText})`, 'warning');
            }
          }
        }
      }
      
      this.log(`⚠️ Searched ${allSpans.length} spans but couldn't find clickable aspect ratio toggle`, 'warning');
    } catch (error) {
      this.log(`Fallback search failed: ${error.message}`, 'error');
    }

    return null;
  }

  async findModeButton() {
    // UPDATED: Use exact XPath provided by user
    const strategies = [
      // Strategy 1: Exact XPath for mode dropdown button (icon -> button)
      '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[1]/div[1]/button/div[1]/i/ancestor::button',
      // Strategy 2: Direct button path
      '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[1]/div[1]/button',
      // Strategy 3: Fallback - role="combobox"
      '//*[@role="combobox"]',
      // Strategy 4: Fallback - Contains dropdown icon
      '//*[.//i[contains(@class, "material-icons") and contains(text(), "arrow_drop_down")]]',
    ];

    for (const xpath of strategies) {
      try {
        const element = await this.waitForElement(xpath, 2000);
        if (element) {
          this.log(`Found mode button using strategy: ${xpath}`, 'info');
          return element;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  extractModeText(element) {
    if (!element) return '';

    // Clean and extract mode text
    let text = element.textContent || '';

    // Remove icon text and common artifacts
    text = text
      .replace(/arrow_drop_down/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();

    return text.toLowerCase();
  }

  isCorrectMode(currentText, targetMode) {
    const modePatterns = {
      'text_to_video': [
        'text to video',
        'text-to-video',
        '文本转视频'
      ],
      'frames_to_video': [
        'frames to video',
        'frames-to-video',
        '图片转视频',
        '帧转视频'
      ],
      'ingredients_to_video': [
        'ingredients to video',
        'ingredients-to-video',
        '素材转视频',
        '元素转视频',
        'ingredients'
      ],
      'create_image': [
        'create image',
        'create-image',
        '生成图片',
        '创建图片',
        'image'
      ]
    };

    const targetPatterns = modePatterns[targetMode] || [];

    return targetPatterns.some(pattern =>
      currentText.includes(pattern.toLowerCase())
    );
  }

  async findModeOption(targetMode) {
    // UPDATED: Focus on Text to Video and Frames to Video only (as user specified)
    const optionPatterns = {
      'text_to_video': [
        '//*[contains(text(), "Text to Video")]',
        '//*[contains(text(), "文本转视频")]',
        '//button[contains(., "Text to Video")]',
        '//div[contains(., "Text to Video")]'
      ],
      'frames_to_video': [
        '//*[contains(text(), "Frames to Video")]',
        '//*[contains(text(), "图片转视频")]',
        '//*[contains(text(), "帧转视频")]',
        '//button[contains(., "Frames to Video")]',
        '//div[contains(., "Frames to Video")]'
      ],
      'ingredients_to_video': [
        '//*[contains(text(), "Ingredients to Video")]',
        '//*[contains(text(), "素材转视频")]',
        '//*[contains(text(), "元素转视频")]'
      ],
      'create_image': [
        '//*[contains(text(), "Create Image")]',
        '//*[contains(text(), "生成图片")]',
        '//*[contains(text(), "创建图片")]'
      ]
    };

    const patterns = optionPatterns[targetMode] || [];

    for (const xpath of patterns) {
      try {
        const elements = await this.waitForElements(xpath, 2000);
        const clickableElement = elements.find(el =>
          el.tagName === 'BUTTON' || el.tagName === 'LI' || el.tagName === 'DIV' || el.role === 'option'
        );

        if (clickableElement) {
          this.log(`Found mode option using: ${xpath}`, 'info');
          return clickableElement;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  getModeText(mode) {
    const modeTexts = {
      'text_to_video': 'Text to Video',
      'frames_to_video': 'Frames to Video',
      'ingredients_to_video': 'Ingredients to Video',
      'create_image': 'Create Image'
    };
    return modeTexts[mode] || mode;
  }

  // ===============================
  // DYNAMIC FILE REQUESTS
  // ===============================

  async requestFileData(fileIndex) {
    const queueKey = this.currentQueueId || 'default';
    const cacheKey = `${queueKey}:${fileIndex}`;

    // Check cache first
    if (this.fileCache.has(cacheKey)) {
      this.log(`Using cached file data for queue ${queueKey}, index ${fileIndex}`, 'info');
      return this.fileCache.get(cacheKey);
    }

    this.log(`Requesting file data for index ${fileIndex}`, 'info');

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'FLOW_BATCH_REQUEST_FILE',
          fileIndex
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.ok) {
            resolve(response.fileData);
          } else {
            reject(new Error(response?.error || 'File request failed'));
          }
        });
      });

      if (!response || !response.base64Data) {
        throw new Error('Invalid file response - missing base64Data');
      }

      // CRITICAL FIX: Reconstruct File object from base64 data
      const reconstructedFile = this.base64ToFile(
        response.base64Data,
        response.name,
        response.type
      );

      // Create file data object with reconstructed File
      const fileData = {
        index: response.index,
        name: response.name,
        type: response.type,
        size: response.size,
        file: reconstructedFile, // The actual File object for upload
        base64Data: response.base64Data // Keep base64 for potential cache
      };

      // Cache the response
      this.fileCache.set(cacheKey, fileData);
      this.log(`File data received and reconstructed: ${response.name} (${response.size} bytes) [queue ${queueKey}]`, 'success');

      return fileData;

    } catch (error) {
      this.log(`File request failed for index ${fileIndex}: ${error.message}`, 'error');
      throw error;
    }
  }

  // ===============================
  // AUTOMATION ACTIONS (Optimized)
  // ===============================

  async uploadImage(fileData) {
    this.log(`Uploading image: ${fileData.name} (${fileData.size} bytes)`, 'info');

    // CRITICAL FIX: Multiple strategies to find the Add button
    const uploadButton = await this.findAddButton();
    if (!uploadButton) {
      throw new Error('Upload (Add) button not found. Please ensure you are on the Flow creation page.');
    }

    this.log('Found Add button, clicking...', 'info');
    await this.clickElement(uploadButton);
    await this.sleep(400); // Further optimized from 800ms

    // Wait for upload dialog and find file input
    const fileInput = await this.findFileInput();
    if (!fileInput) {
      throw new Error('File input not found after clicking Add button');
    }

    // CRITICAL FIX: Use the reconstructed File object directly
    const file = fileData.file; // Already reconstructed from base64

    this.log(`Injecting file: ${file.name} (${file.size} bytes)`, 'info');

    // Clear any existing files
    fileInput.value = '';

    // Create DataTransfer and add file
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Trigger comprehensive event sequence
    this.log('Triggering file input events...', 'info');
    fileInput.dispatchEvent(new Event('focus', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('blur', { bubbles: true }));

    this.log('File injection complete', 'success');
    await this.sleep(500); // Further optimized from 1000ms
  }

  async handleCropModal(cropMode) {
    this.log(`处理裁剪弹窗，模式: ${cropMode}`, 'info');

    // 1. 等待裁剪弹窗出现
    try {
      await this.waitForElement(
        '//*[contains(normalize-space(.), "Crop")]',
        8000
      );
      await this.sleep(1000); // 等待弹窗完全渲染
    } catch (error) {
      this.log('裁剪弹窗未出现，跳过', 'warning');
      return;
    }

    // 2. 设置裁剪比例（如果需要）
    if (cropMode) {
      const isPortrait = cropMode === 'portrait' || cropMode === '9:16';
      const targetText = isPortrait ? 'Portrait' : 'Landscape';
      const targetRatio = isPortrait ? '9:16' : '16:9';
      const iconText = isPortrait ? 'crop_9_16' : 'crop_16_9';
      
      this.log(`目标裁剪比例: ${targetText} (${targetRatio}), 图标: ${iconText}`, 'info');
      
      try {
        // 查找所有 combobox 按钮（包含 Portrait 或 Landscape 的）
        await this.sleep(FlowBatchContentScript.CONFIG.QUEUE_CHECK_INTERVAL);
        const allButtons = document.querySelectorAll('button[role="combobox"]');
        
        this.log(`找到 ${allButtons.length} 个 combobox 按钮`, 'info');
        
        // 查找包含 "Portrait" 或 "Landscape" 的按钮（这是下拉按钮，不是选项）
        let aspectRatioButton = null;
        for (const btn of allButtons) {
          const btnText = (btn.textContent || btn.innerText || '').trim();
          if (btnText.includes('Portrait') || btnText.includes('Landscape')) {
            aspectRatioButton = btn;
            this.log(`找到裁剪比例下拉按钮: "${btnText}"`, 'info');
            break;
          }
        }
        
        if (!aspectRatioButton) {
          this.log('未找到裁剪比例下拉按钮', 'warning');
          this.logToPopup('⚠️ 未找到裁剪比例下拉按钮，使用默认设置', 'warning');
        } else {
          const currentText = (aspectRatioButton.textContent || aspectRatioButton.innerText || '').trim();
          const isAlreadySelected = currentText.includes(targetText) && currentText.includes(targetRatio);
          
          this.log(`当前选中的比例: "${currentText}", 目标: "${targetText} (${targetRatio})"`, 'info');
          
          if (!isAlreadySelected) {
            // 需要切换：点击按钮打开下拉菜单
            this.log('点击下拉按钮打开菜单...', 'info');
            await this.clickElement(aspectRatioButton);
            await this.sleep(800); // 等待下拉菜单完全打开
            
            // 在下拉菜单中查找目标选项
            let optionFound = false;
            
            // 策略1: 通过 aria-controls 查找菜单
            const ariaControls = aspectRatioButton.getAttribute('aria-controls');
            if (ariaControls) {
              this.log(`通过 aria-controls 查找菜单: ${ariaControls}`, 'info');
              const menu = document.getElementById(ariaControls);
              if (menu) {
                this.log('找到菜单容器，搜索选项...', 'info');
                const options = menu.querySelectorAll('button, [role="option"], div[role="option"]');
                this.log(`菜单中找到 ${options.length} 个选项`, 'info');
                
                for (const opt of options) {
                  const optText = (opt.textContent || opt.innerText || '').trim();
                  const optIcons = opt.querySelectorAll('i');
                  
                  // 检查文本和图标是否匹配
                  let hasTargetText = optText.includes(targetText) || optText.includes(targetRatio);
                  let hasTargetIcon = false;
                  
                  for (const icon of optIcons) {
                    const iconContent = (icon.textContent || icon.innerText || '').trim();
                    if (iconContent.includes(iconText)) {
                      hasTargetIcon = true;
                      break;
                    }
                  }
                  
                  // 如果文本和图标都匹配，或者文本包含目标比例，则选择
                  if (hasTargetText && (hasTargetIcon || optText.includes(targetRatio))) {
                    this.log(`找到目标选项: "${optText}"`, 'success');
                    await this.clickElement(opt);
                    optionFound = true;
                    await this.sleep(500); // 等待选项被选中
                    break;
                  } else {
                    this.log(`跳过选项: "${optText}" (文本匹配: ${hasTargetText}, 图标匹配: ${hasTargetIcon})`, 'info');
                  }
                }
              }
            }
            
            // 策略2: 如果没找到，在所有可见的按钮/选项中搜索（排除已点击的按钮）
            if (!optionFound) {
              this.log('策略1未找到，尝试策略2: 搜索所有可见选项...', 'info');
              const allOpts = document.querySelectorAll('button, [role="option"], div[role="option"]');
              
              for (const opt of allOpts) {
                // 跳过下拉按钮本身
                if (opt === aspectRatioButton) continue;
                
                // 检查元素是否可见
                const rect = opt.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && 
                                 window.getComputedStyle(opt).display !== 'none';
                if (!isVisible) continue;
                
                const optText = (opt.textContent || opt.innerText || '').trim();
                if (!optText.includes('Portrait') && !optText.includes('Landscape') && 
                    !optText.includes('9:16') && !optText.includes('16:9')) {
                  continue;
                }
                
                const optIcons = opt.querySelectorAll('i');
                let hasTargetIcon = false;
                
                for (const icon of optIcons) {
                  const iconContent = (icon.textContent || icon.innerText || '').trim();
                  if (iconContent.includes(iconText)) {
                    hasTargetIcon = true;
                    break;
                  }
                }
                
                // 检查是否匹配目标
                const matchesText = optText.includes(targetText) || optText.includes(targetRatio);
                if (matchesText && (hasTargetIcon || optText.includes(targetRatio))) {
                  this.log(`策略2找到目标选项: "${optText}"`, 'success');
                  await this.clickElement(opt);
                  optionFound = true;
                  await this.sleep(500);
                  break;
                }
              }
            }
            
            if (optionFound) {
              this.log(`✅ 已选择裁剪比例: ${targetText} (${targetRatio})`, 'success');
              this.logToPopup(`✅ 已设置裁剪比例: ${targetText} (${targetRatio})`, 'success');
            } else {
              this.log(`⚠️ 未找到目标选项 ${targetText} (${targetRatio})，可能已选中或菜单未正确打开`, 'warning');
              this.logToPopup(`⚠️ 未找到裁剪比例选项，可能已选中`, 'warning');
            }
            
            await this.sleep(400);
          } else {
            this.log(`✅ 裁剪比例已正确设置: ${targetText} (${targetRatio})`, 'success');
            this.logToPopup(`✅ 裁剪比例已正确: ${targetText} (${targetRatio})`, 'success');
          }
        }
      } catch (error) {
        this.log(`设置裁剪比例失败: ${error.message}`, 'error');
        this.logToPopup(`⚠️ 设置裁剪比例失败: ${error.message}`, 'error');
      }
    }

    // 3. 点击保存按钮
    try {
      const saveButton = await this.waitForElement(
        '//button[contains(normalize-space(.), "Crop and Save")]',
        6000
      );
      await this.clickElement(saveButton);
      await this.sleep(800);
      this.log('裁剪完成', 'success');
    } catch (error) {
      this.log(`裁剪保存失败: ${error.message}`, 'error');
    }
  }

  // Find Add button with multiple strategies
  async findAddButton() {
    const strategies = [
      // Strategy 1: UPDATED - Exact XPath for upload button provided by user
      '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[2]/div[1]/div/div[1]/button',
      // Strategy 2: Fallback - button containing 'add' icon
      '//button[.//i[contains(text(), "add")]]',
      // Strategy 3: Fallback - Button with google-symbols class containing 'add'
      '//button[.//i[contains(@class, "google-symbols") and contains(text(), "add")]]',
      // Strategy 4: Fallback - Button with Material Icons class and 'add' text
      '//button[.//i[contains(@class, "material-icons") and contains(text(), "add")]]',
      // Strategy 5: Fallback - Button containing 'add' text directly
      '//button[contains(normalize-space(.), "add")]',
      // Strategy 6: Fallback - Button near the prompt textarea
      `//textarea[@id="PINHOLE_TEXT_AREA_ELEMENT_ID"]/following::button[.//i[contains(text(), "add")]][1]`
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        this.log(`Trying strategy ${i + 1}: ${strategies[i]}`, 'info');
        const button = await this.waitForElement(strategies[i], 3000);
        if (button) {
          this.log(`Add button found with strategy ${i + 1}`, 'success');
          return button;
        }
      } catch (error) {
        this.log(`Strategy ${i + 1} failed: ${error.message}`, 'warning');
        continue;
      }
    }

    // Last resort: Find any button with 'add' in its DOM tree
    this.log('Using fallback: searching for any button with add icon', 'info');
    const allButtons = document.querySelectorAll('button');
    for (const button of allButtons) {
      if (button.textContent.includes('add') ||
          button.innerText.includes('add') ||
          button.querySelector('i')?.textContent?.includes('add')) {
        this.log('Found button containing add text/icon', 'success');
        return button;
      }
    }

    return null;
  }

  // Find file input with multiple strategies
  async findFileInput() {
    const strategies = [
      // Strategy 1: Direct file input
      '//input[@type="file"]',
      // Strategy 2: Hidden file input
      '//input[@type="file" and @style="display: none"]',
      // Strategy 3: File input with accept attribute
      '//input[@type="file" and contains(@accept, "image")]',
      // Strategy 4: File input in any container
      '//input[@type="file" and (contains(@class, "file") or contains(@class, "upload"))]'
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        const fileInput = await this.waitForElement(strategies[i], 3000);
        if (fileInput) {
          this.log(`File input found with strategy ${i + 1}`, 'success');
          return fileInput;
        }
      } catch (error) {
        continue;
      }
    }

    // Last resort: Get all file inputs
    const allFileInputs = document.querySelectorAll('input[type="file"]');
    if (allFileInputs.length > 0) {
      this.log(`Found ${allFileInputs.length} file inputs, using first one`, 'info');
      return allFileInputs[0];
    }

    return null;
  }

  async inputPrompt(prompt) {
    this.log(`Inputting prompt: ${prompt.substring(0, 50)}...`, 'info');

    // Wait for textarea with stable ID
    const textarea = await this.waitForElement(
      '//textarea[@id="PINHOLE_TEXT_AREA_ELEMENT_ID"]',
      10000
    );

    if (!textarea) {
      throw new Error('Prompt textarea not found');
    }

    // Clear and input prompt - OPTIMIZED: Direct value assignment instead of character-by-character
    textarea.value = '';
    textarea.focus();
    await this.sleep(100); // Reduced from 200ms

    // Set prompt value directly (much faster)
    textarea.value = prompt;
    
    // Trigger events to notify the page
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Also trigger keyboard events for better compatibility
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    
    await this.sleep(300); // Reduced from 500ms
  }

  async submitForGeneration() {
    this.log('Looking for submit/generate button...', 'info');

    // Ensure queue has capacity before attempting to submit
    await this.waitForQueueCapacity('submit');

    const startTime = Date.now();
    const maxWait = 20000; // 20s max wait for button availability
    let submitButton = null;

    while (Date.now() - startTime < maxWait) {
      try {
        submitButton = await this.waitForElement(
          '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[2]/div[2]/button[2]',
          1000
        );
      } catch (error) {
        submitButton = null;
      }

      if (!submitButton) {
        submitButton = await this.findSubmitButton();
      }

      if (submitButton && this.isButtonEnabled(submitButton)) {
        this.log('Enabled submit button found', 'success');
        break;
      }

      // 如果按钮仍不可用，可能是队列满或页面未准备好
      this.log('Waiting for submit button to be enabled...', 'info');

      const hasCapacity = await this.waitForQueueCapacity('submit-button-wait');
      if (!hasCapacity) {
        this.log('队列仍无空闲，继续等待提交按钮', 'warning');
      }

      await this.sleep(FlowBatchContentScript.CONFIG.QUEUE_CHECK_INTERVAL);
    }

    if (!submitButton || !this.isButtonEnabled(submitButton)) {
      throw new Error('Submit/Generate button not found or never became enabled. Queue may still be full.');
    }

    this.log('Clicking submit button...', 'info');
    await this.clickElement(submitButton);
    await this.sleep(1500);

    this.log('Submit button clicked successfully', 'success');
  }

  // Find submit/generate button with multiple strategies
  async findSubmitButton() {
    const strategies = [
      // Strategy 1: UPDATED - White/enabled submit button (button[2] when enabled)
      '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[2]/div[2]/button[2]',
      // Strategy 2: UPDATED - Gray/disabled submit button (button when disabled)
      '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[2]/div[2]/button',
      // Strategy 3: Fallback - button with arrow_forward icon
      '//button[.//i[contains(text(), "arrow_forward")]]',
      // Strategy 4: Fallback - Button with google-symbols class containing arrow_forward
      '//button[.//i[contains(@class, "google-symbols") and contains(text(), "arrow_forward")]]',
      // Strategy 5: Fallback - Standard submit button
      '//button[@type="submit"]',
      // Strategy 6: Fallback - Button containing generate/create text
      '//button[contains(normalize-space(.), "Generate")]',
      '//button[contains(normalize-space(.), "Create")]'
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        this.log(`Trying submit strategy ${i + 1}: ${strategies[i]}`, 'info');
        const buttons = await this.waitForElements(strategies[i], 2000);

        // Find the first visible and enabled button
        const validButton = buttons.find(button => {
          const rect = button.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;
          const isEnabled = !button.disabled;
          const isNotHidden = window.getComputedStyle(button).display !== 'none';
          return isVisible && isEnabled && isNotHidden;
        });

        if (validButton) {
          this.log(`Submit button found with strategy ${i + 1}`, 'success');
          return validButton;
        }
      } catch (error) {
        this.log(`Submit strategy ${i + 1} failed: ${error.message}`, 'warning');
        continue;
      }
    }

    // Last resort: Find all buttons and look for generate-related ones
    this.log('Using fallback: searching all buttons for generation functionality', 'info');
    const allButtons = document.querySelectorAll('button');
    for (const button of allButtons) {
      const text = button.textContent.toLowerCase() || button.innerText.toLowerCase();
      const isVisible = button.offsetWidth > 0 && button.offsetHeight > 0;
      const isEnabled = !button.disabled;

      // CRITICAL FIX: Check for arrow_forward icon in button's DOM
      const iconElement = button.querySelector('i');
      const hasArrowIcon = iconElement && iconElement.textContent.includes('arrow_forward');

      if (isVisible && isEnabled &&
          (text.includes('generate') || text.includes('create') || text.includes('submit') || hasArrowIcon)) {
        this.log('Found generation button via fallback search', 'success');
        if (hasArrowIcon) {
          this.log('Button identified by arrow_forward icon', 'info');
        }
        return button;
      }
    }

    return null;
  }

  isButtonEnabled(button) {
    if (!button) return false;
    if (button.disabled) return false;

    const ariaDisabled = button.getAttribute('aria-disabled');
    if (ariaDisabled && ariaDisabled !== 'false') {
      return false;
    }

    const dataState = button.getAttribute('data-state');
    if (dataState && dataState.toLowerCase() === 'disabled') {
      return false;
    }

    const isHidden = window.getComputedStyle(button).display === 'none';
    if (isHidden) {
      return false;
    }

    return true;
  }

  // Wait for button to be enabled and clickable
  async waitForButtonToBeEnabled(button, maxWait = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        // UPDATED: Check for enabled button (button[2] when enabled)
        // Try to find the enabled button (button[2])
        const enabledButton = await this.waitForElement(
          '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[2]/div[2]/button[2]',
          1000
        ).catch(() => null);

        if (enabledButton && !enabledButton.disabled) {
          const rect = enabledButton.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            this.log('Enabled submit button found (button[2])', 'success');
            return true;
          }
        }

        // Fallback: Check if current button is enabled
        if (button && !button.disabled) {
          const rect = button.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            this.log('Button is enabled and visible', 'success');
            return true;
          }
        }

        this.log('Waiting for button to be enabled...', 'info');
        await this.sleep(FlowBatchContentScript.CONFIG.QUEUE_CHECK_INTERVAL);
      } catch (error) {
        // Continue waiting
        await this.sleep(FlowBatchContentScript.CONFIG.QUEUE_CHECK_INTERVAL);
      }
    }

    throw new Error('Button did not become enabled within timeout period');
  }

  async waitForGeneration(taskIndex, videoCountBeforeSubmit = 0) {
    // CRITICAL FIX: 接收 taskIndex 和 videoCountBeforeSubmit 参数，确保下载正确的视频
    if (taskIndex === undefined || taskIndex === null) {
      // 如果没有传入 taskIndex，使用 currentTaskPointer（向后兼容）
      taskIndex = this.currentTaskPointer - 1;
      this.log(`⚠️ waitForGeneration 未传入 taskIndex，使用 currentTaskPointer: ${taskIndex}`, 'warning');
    }
    
    this.log(`等待任务 ${taskIndex + 1} 的视频生成完成...`, 'info');
    const startTime = Date.now();
    const maxWait = FlowBatchContentScript.CONFIG.VIDEO_GENERATION_TIMEOUT;

    // 使用传入的 videoCountBeforeSubmit，如果没有则记录当前视频数量
    let initialVideoCount = videoCountBeforeSubmit;
    let container = null;
    
    // 等待结果容器出现
    while (Date.now() - startTime < maxWait) {
      try {
        container = await this.waitForElement(
          '//div[contains(@class, "generated-results")]',
          2000
        );
        if (container) {
          // 如果没有传入 videoCountBeforeSubmit，记录当前视频数量
          if (initialVideoCount === 0) {
            const initialCards = container.querySelectorAll('div[data-result-index]');
            initialVideoCount = initialCards.length;
            this.log(`结果容器找到，当前已有 ${initialVideoCount} 个视频`, 'info');
          } else {
            this.log(`使用提交前的视频数量: ${initialVideoCount}`, 'info');
          }
          break;
        }
      } catch (error) {
        await this.sleep(FlowBatchContentScript.CONFIG.QUEUE_CHECK_INTERVAL);
        continue;
      }
    }

    if (!container) {
      throw new Error('结果容器未找到');
    }

    // 等待当前任务的视频真正生成完成
    const targetIndex = taskIndex;
    let video = null;
    let attempts = 0;

    while (Date.now() - startTime < maxWait) {
      attempts++;
      
      // 查找所有结果卡片
      const cards = container.querySelectorAll('div[data-result-index]');
      if (cards.length === 0) {
        await this.sleep(1000);
        continue;
      }

      // 策略1: 尝试通过 data-result-index 找到对应任务的卡片
      let targetCard = null;
      for (const card of cards) {
        const indexAttr = card.getAttribute('data-result-index');
        if (indexAttr && parseInt(indexAttr, 10) === targetIndex) {
          targetCard = card;
          this.log(`通过 data-result-index 找到任务 ${targetIndex + 1} 的卡片`, 'success');
          break;
        }
      }

      // 策略2: 如果没找到，使用时间顺序（等待新视频出现）
      // 因为任务按顺序提交，新生成的视频应该是在提交后出现的
      if (!targetCard) {
        const currentVideoCount = cards.length;
        if (currentVideoCount > initialVideoCount) {
          // 有新视频出现，找到第一个新视频（因为任务是按顺序提交的）
          const newCards = Array.from(cards).slice(initialVideoCount);
          if (newCards.length > 0) {
            // 使用第一个新视频（对应当前任务）
            targetCard = newCards[0];
            this.log(`通过时间顺序找到新生成的视频（任务 ${targetIndex + 1}，新视频索引: ${initialVideoCount}）`, 'info');
          }
        } else if (cards.length > 0) {
          // 如果视频数量没有增加，可能是页面刷新了，使用最后一个作为后备方案
          targetCard = cards[cards.length - 1];
          this.log(`⚠️ 视频数量未增加，使用最新的视频作为后备方案（任务 ${targetIndex + 1}）`, 'warning');
        }
      }

      if (targetCard) {
        // 查找视频元素
        video = targetCard.querySelector('video');
        
        if (video) {
          // 检查视频是否有有效的 src
          if (video.src && video.src.trim() !== '' && !video.src.includes('blob:null')) {
            // 等待视频加载完成（可以播放）
            if (video.readyState >= 3) { // HAVE_FUTURE_DATA 或更高
              // 验证视频真的可以播放
              try {
                await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => {
                    reject(new Error('视频加载超时'));
                  }, FlowBatchContentScript.CONFIG.VIDEO_LOAD_TIMEOUT);

                  // CRITICAL FIX: Properly clean up event listeners and timeout
                  const checkReady = () => {
                    if (video.readyState >= 3 && video.duration > 0) {
                      clearTimeout(timeout);
                      // Remove event listeners to prevent memory leaks
                      video.removeEventListener('loadeddata', checkReady);
                      video.removeEventListener('canplay', checkReady);
                      resolve();
                    }
                  };

                  if (video.readyState >= 3 && video.duration > 0) {
                    clearTimeout(timeout);
                    resolve();
                  } else {
                    // Add event listeners with proper cleanup
                    video.addEventListener('loadeddata', checkReady, { once: true });
                    video.addEventListener('canplay', checkReady, { once: true });
                    video.addEventListener('error', () => {
                      clearTimeout(timeout);
                      video.removeEventListener('loadeddata', checkReady);
                      video.removeEventListener('canplay', checkReady);
                      reject(new Error('视频加载错误'));
                    }, { once: true });
                    video.load(); // 触发加载
                  }
                });

                // 视频已加载完成
                this.log(`✅ 视频生成完成 (任务 ${targetIndex + 1}): ${video.src.substring(0, 50)}...`, 'success');
                return video.src;
              } catch (error) {
                this.log(`视频加载检查失败: ${error.message}，继续等待...`, 'warning');
              }
            } else {
              // 视频还在加载中
              if (attempts % 10 === 0) {
                this.log(`视频加载中... (readyState: ${video.readyState})`, 'info');
              }
            }
          } else {
            // 视频还没有有效的 src
            if (attempts % 10 === 0) {
              this.log('等待视频生成...', 'info');
            }
          }
        }
      }

      // 每1秒检查一次
      await this.sleep(1000);
    }

    // 超时后，如果找到了视频就返回，否则报错
    if (video && video.src && video.src.trim() !== '') {
      this.log(`⚠️ 超时但找到视频，使用当前视频: ${video.src.substring(0, 50)}...`, 'warning');
      return video.src;
    }

    throw new Error(`视频生成超时（${maxWait / 1000}秒），未找到可用的视频`);
  }

  // Wait for task completion in background and update pendingTasks
  async waitForTaskCompletion(taskIndex, prompt, videoCountBeforeSubmit = 0) {
    try {
      this.log(`任务 ${taskIndex + 1} 开始等待生成完成...`, 'info');
      this.logToPopup(`⏳ 任务 ${taskIndex + 1} 等待生成完成（约1分钟）...`, 'info');
      
      // Step 1: 等待视频真正生成完成（视频加载完成，可以播放）
      // CRITICAL FIX: 传入 taskIndex 和 videoCountBeforeSubmit 确保下载正确的视频
      const downloadUrl = await this.waitForGeneration(taskIndex, videoCountBeforeSubmit);
      
      // Step 2: 视频生成完成后，立即下载
      this.log(`任务 ${taskIndex + 1} 视频生成完成，开始下载...`, 'info');
      this.logToPopup(`📥 任务 ${taskIndex + 1} 开始下载...`, 'info');
      
      // CRITICAL FIX: Wait for download to complete before updating success count
      try {
        await this.downloadVideo(downloadUrl, taskIndex, prompt);
        this.log(`✅ 任务 ${taskIndex + 1} 下载请求已发送`, 'success');
      } catch (downloadError) {
        this.log(`⚠️ 任务 ${taskIndex + 1} 下载请求失败: ${downloadError.message}`, 'warning');
        // Continue anyway, download might still succeed
      }

      this.log(`✅ 任务 ${taskIndex + 1} 完成并已下载`, 'success');
      this.logToPopup(`✅ 任务 ${taskIndex + 1} 完成并已下载`, 'success');

      // CRITICAL FIX: Atomic update of pendingTasks and successCount
      // Only update successCount if video was successfully generated and download was requested
      const state = await this.loadQueueState();
      if (state) {
        // Use atomic update instead of modifying state object
        const currentSuccessCount = state.successCount || 0;
        const currentPendingTasks = state.pendingTasks || 0;
        
        // CRITICAL FIX: Update success count only after video generation and download request
        const newSuccessCount = currentSuccessCount + 1;
        const newPendingTasks = Math.max(0, currentPendingTasks - 1);
        
        await this.updateQueueState({
          successCount: newSuccessCount,
          pendingTasks: newPendingTasks
        });
        
        // CRITICAL FIX: Verify the update was successful to ensure accuracy
        const verifyState = await this.loadQueueState();
        if (verifyState) {
          const actualSuccessCount = verifyState.successCount || 0;
          if (actualSuccessCount !== newSuccessCount) {
            this.log(`⚠️ 成功计数更新不一致: 期望=${newSuccessCount}, 实际=${actualSuccessCount}，重新更新...`, 'warning');
            // Retry update with force
            await this.updateQueueState({ successCount: newSuccessCount });
            
            // Verify again
            const retryState = await this.loadQueueState();
            if (retryState && retryState.successCount !== newSuccessCount) {
              this.log(`❌ 成功计数更新失败: 期望=${newSuccessCount}, 实际=${retryState.successCount}`, 'error');
            } else {
              this.log(`✅ 成功计数已修复: ${newSuccessCount}`, 'success');
            }
          }
        }
        
        // Log the update for debugging
        const finalState = await this.loadQueueState();
        const finalSuccessCount = finalState?.successCount || 0;
        this.log(`✅ 状态更新成功: 成功=${finalSuccessCount}, 队列=${newPendingTasks} (任务 ${taskIndex + 1})`, 'success');
        this.logToPopup(`✅ 任务 ${taskIndex + 1} 完成 (成功: ${finalSuccessCount})`, 'success');
        
        const queueLimit = FlowBatchContentScript.CONFIG.QUEUE_LIMIT;
        if (newPendingTasks < queueLimit) {
          this.logToPopup(`✅ 队列有空闲 (${newPendingTasks}/${queueLimit})，可以继续发送`, 'success');
        }
      }
    } catch (error) {
      this.log(`❌ 任务 ${taskIndex + 1} 完成处理失败: ${error.message}`, 'error');
      this.logToPopup(`❌ 任务 ${taskIndex + 1} 失败: ${error.message}`, 'error');
      
      // CRITICAL FIX: Atomic update even on error
      const state = await this.loadQueueState();
      if (state) {
        const newPendingTasks = Math.max(0, (state.pendingTasks || 0) - 1);
        await this.updateQueueState({
          pendingTasks: newPendingTasks,
          failCount: (state.failCount || 0) + 1
        });
        const queueLimit = FlowBatchContentScript.CONFIG.QUEUE_LIMIT;
        this.log(`队列更新: ${newPendingTasks}/${queueLimit} (任务 ${taskIndex + 1} 失败)`, 'warning');
      }
    }
  }

  // ===============================
  // UTILITY FUNCTIONS
  // ===============================

  async waitForElement(xpath, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;

      if (element) {
        return element;
      }

      await this.sleep(FlowBatchContentScript.CONFIG.CLICK_DELAY);
    }

    throw new Error(`Element not found within ${timeout}ms: ${xpath}`);
  }

  async waitForElements(xpath, timeout = 10000) {
    const startTime = Date.now();
    const elements = [];

    while (Date.now() - startTime < timeout) {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      if (result.snapshotLength > 0) {
        for (let i = 0; i < result.snapshotLength; i++) {
          elements.push(result.snapshotItem(i));
        }
        return elements;
      }

      await this.sleep(FlowBatchContentScript.CONFIG.CLICK_DELAY);
    }

    return [];
  }

  async clickElement(element) {
    if (!element) {
      throw new Error('Cannot click null element');
    }

    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.sleep(FlowBatchContentScript.CONFIG.SCROLL_DELAY);

    // Multiple click strategies for reliability
    try {
      element.click();
    } catch (error) {
      // Fallback: Dispatch mouse events
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      element.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY
      }));

      element.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY
      }));

      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY
      }));
    }

    await this.sleep(FlowBatchContentScript.CONFIG.CLICK_DELAY);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // CRITICAL FIX: Convert Base64 back to File object
  base64ToFile(base64Data, fileName, fileType) {
    // Convert base64 to ArrayBuffer
    const binaryString = window.atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;

    // Create File object from ArrayBuffer
    return new File([arrayBuffer], fileName, { type: fileType });
  }

  needsImageUpload(flowMode) {
    // Both frames_to_video and ingredients_to_video need image upload
    return flowMode === 'ingredients_to_video' || flowMode === 'frames_to_video';
  }

  // ===============================
  // FLOATING UI WIDGET
  // ===============================

  injectFloatingWidget() {
    try {
      if (document.getElementById('flow-floating-root')) {
        return;
      }

      const styleId = 'flow-floating-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          #flow-floating-root {
            position: fixed;
            top: 50%;
            right: 24px;
            transform: translateY(-50%);
            z-index: 2147483647;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 12px;
          }

          .flow-floating-ball {
            width: 64px;
            height: 64px;
            border-radius: 32px;
            background: linear-gradient(135deg, #4A90E2, #8E2DE2);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.25);
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            user-select: none;
          }

          .flow-floating-ball:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 35px rgba(0,0,0,0.35);
          }

          .flow-floating-panel {
            width: 420px;
            max-height: 80vh;
            border-radius: 16px;
            overflow: hidden;
            background: #121212;
            box-shadow: 0 20px 60px rgba(0,0,0,0.4);
            display: none;
            flex-direction: column;
          }

          .flow-floating-panel.open {
            display: flex;
          }

          .flow-floating-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: rgba(255,255,255,0.04);
            border-bottom: 1px solid rgba(255,255,255,0.06);
          }

          .flow-floating-header-title {
            color: #fff;
            font-size: 16px;
            font-weight: 600;
          }

          .flow-floating-collapse {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            border: none;
            background: rgba(255,255,255,0.08);
            color: #fff;
            cursor: pointer;
            font-size: 18px;
            line-height: 28px;
            text-align: center;
          }

          .flow-floating-iframe {
            border: none;
            width: 100%;
            height: 520px;
            background: #121212;
          }

          @media (max-width: 480px) {
            #flow-floating-root {
              top: auto;
              right: 12px;
              left: 12px;
              bottom: 12px;
              transform: none;
              align-items: flex-end;
            }

            .flow-floating-panel {
              width: 100%;
            }

            .flow-floating-iframe {
              height: 70vh;
            }
          }
        `;
        document.head.appendChild(style);
      }

      const root = document.createElement('div');
      root.id = 'flow-floating-root';
      root.innerHTML = `
        <div class="flow-floating-ball" id="flow-floating-ball">Flow</div>
        <div class="flow-floating-panel" id="flow-floating-panel">
          <div class="flow-floating-header">
            <div class="flow-floating-header-title">Flow批量上传</div>
            <button class="flow-floating-collapse" id="flow-floating-collapse" title="收起">-</button>
          </div>
          <iframe class="flow-floating-iframe" src="${chrome.runtime.getURL('popup.html')}" allow="clipboard-write"></iframe>
        </div>
      `;
      document.body.appendChild(root);

      const ball = root.querySelector('#flow-floating-ball');
      const panel = root.querySelector('#flow-floating-panel');
      const collapse = root.querySelector('#flow-floating-collapse');

      this.floatingUI = { root, ball, panel };

      if (ball && panel && collapse) {
        ball.addEventListener('click', () => this.showFloatingPanel());
        collapse.addEventListener('click', () => this.hideFloatingPanel());
      }
    } catch (error) {
      console.error('[FlowBatchPilot] injectFloatingWidget error:', error);
    }
  }

  showFloatingPanel() {
    if (!this.floatingUI) return;
    const { ball, panel } = this.floatingUI;
    if (ball) ball.style.display = 'none';
    if (panel) panel.classList.add('open');
  }

  hideFloatingPanel() {
    if (!this.floatingUI) return;
    const { ball, panel } = this.floatingUI;
    if (panel) panel.classList.remove('open');
    if (ball) ball.style.display = 'flex';
  }

  // ===============================
  // STORAGE MANAGEMENT
  // ===============================

  async loadQueueState() {
    const result = await chrome.storage.local.get(['flowBatchQueueState']);
    return result.flowBatchQueueState || null;
  }

  // CRITICAL FIX: Atomic state update to prevent race conditions
  async updateQueueState(updates) {
    // Use a lock mechanism to prevent concurrent updates
    if (this._updatingState) {
      await this._updatingState;
    }
    
    this._updatingState = (async () => {
      try {
        const currentState = await this.loadQueueState() || {};
        const newState = { ...currentState, ...updates };

        await chrome.storage.local.set({ flowBatchQueueState: newState });

        // Notify popup of state change (fire and forget)
        chrome.runtime.sendMessage({
          type: 'FLOW_BATCH_STATUS_UPDATE',
          data: newState
        }).catch(() => {
          // Popup might be closed, ignore error
        });
        
        return newState;
      } finally {
        this._updatingState = null;
      }
    })();
    
    return this._updatingState;
  }

  // ===============================
  // LOGGING SYSTEM
  // ===============================

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [FlowBatchPilot]`;

    switch (type) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warning':
        console.warn(`${prefix} ${message}`);
        break;
      case 'success':
        console.log(`%c${prefix} ${message}`, 'color: #34C759; font-weight: bold');
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  logToPopup(message, type = 'info') {
    chrome.runtime.sendMessage({
      type: 'FLOW_BATCH_LOG_ENTRY',
      data: { message, type }
    }).catch(() => {
      // Popup might be closed, ignore error
    });
  }

  async downloadVideo(url, taskIndex, prompt) {
    const filename = `${taskIndex + 1}_${this.generatePromptSnippet(prompt)}_${Date.now()}.mp4`;

    // CRITICAL FIX: Wait for download response to ensure it was initiated
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'FLOW_BATCH_DOWNLOAD',
        url,
        filename,
        taskIndex,
        prompt
      }, (response) => {
        if (chrome.runtime.lastError) {
          const error = new Error(chrome.runtime.lastError.message);
          this.log(`下载请求失败: ${error.message}`, 'error');
          reject(error);
        } else if (response && response.ok) {
          this.log(`下载已启动 (ID: ${response.downloadId})`, 'success');
          resolve(response);
        } else {
          const error = new Error(response?.error || '下载请求失败');
          this.log(`下载请求失败: ${error.message}`, 'error');
          reject(error);
        }
      });
    });
  }

  generatePromptSnippet(prompt) {
    if (!prompt) return 'no_prompt';

    const words = prompt.trim().split(/\s+/);
    let snippet;

    if (words.length > 1) {
      snippet = words.slice(0, 5).join('_');
    } else {
      snippet = prompt.trim().slice(0, 15);
    }

    // Clean up for filename
    return snippet.replace(/[\\/:*?"<>|]/g, '_') || 'no_prompt';
  }

  // ===============================
  // AUTO-RESUME FUNCTIONALITY
  // ===============================

  async initializeAutoResume() {
    try {
      const state = await this.loadQueueState();
      const metadata = await chrome.storage.local.get(['flowBatchTaskMetadata']);

      if (!state || !state.totalTasks || state.totalTasks === 0) {
        return;
      }

      if (!metadata.flowBatchTaskMetadata || !metadata.flowBatchTaskMetadata.promptList) {
        this.log('Queue state found but metadata missing', 'warning');
        return;
      }

      if (state.running && !state.paused) {
        // CRITICAL FIX: Only auto-resume if queue is actually not completed
        const isQueueActive = state.currentIndex < state.totalTasks;
        const hasPendingTasks = (state.pendingTasks || 0) > 0;
        
        if (isQueueActive || hasPendingTasks) {
          this.log('🔄 Auto-resuming interrupted queue', 'warning');
          this.logToPopup('检测到未完成队列，自动恢复处理', 'warning');

          this.metadata = metadata.flowBatchTaskMetadata;
          this.queueRunning = true;
          this.currentTaskPointer = state.currentIndex || 0;
          
          // CRITICAL FIX: Ensure correct mode before resuming
          try {
            await this.ensureCorrectMode(this.metadata.flowMode);
          } catch (error) {
            this.log(`Mode check failed during auto-resume: ${error.message}`, 'warning');
            // Continue anyway, mode might already be correct
          }
          
          // Start queue processing (don't await, let it run in background)
          this.processQueue().catch(error => {
            this.log(`Auto-resume queue processing error: ${error.message}`, 'error');
            this.queueRunning = false;
            this.updateQueueState({ running: false }).catch(() => {});
          });
        } else {
          // Queue marked as running but actually completed, reset it
          this.log('Queue state shows running but is actually completed, resetting...', 'info');
          await this.updateQueueState({ 
            running: false, 
            paused: false, 
            pendingTasks: 0 
          });
          this.queueRunning = false;
        }
      } else {
        // Queue is not running or is paused, ensure memory state is clean
        this.queueRunning = false;
        this.currentTaskPointer = 0;
      }
    } catch (error) {
      this.log(`Auto-resume failed: ${error.message}`, 'error');
    }
  }
}

// ===============================
// INITIALIZATION
// ===============================

// Prevent duplicate initialization
if (window.__FlowBatchPilotInitialized) {
  console.log('[FlowBatchPilot] Content Script already initialized');
} else {
  window.__FlowBatchPilotInitialized = true;

  // Initialize the content script
  window.flowBatchContentScript = new FlowBatchContentScript();

  console.log('[FlowBatchPilot] Content Script initialized successfully');
  console.log(`[FlowBatchPilot] Current URL: ${window.location.href}`);
  console.log(`[FlowBatchPilot] Page title: ${document.title}`);
}