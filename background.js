// background.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("[FlowBatchPilot] 已安装");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || msg.type !== "FLOW_BATCH_DOWNLOAD") return;

    const { url, filename, taskIndex, prompt } = msg;
    if (!url) {
      sendResponse && sendResponse({ ok: false, error: "缺少下载 URL" });
      return;
    }

    const safeFilename = sanitizeFilename(filename || "flow_video.mp4");

    try {
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          {
            url,
            filename: safeFilename,
            conflictAction: "uniquify"
          },
          (id) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            resolve(id);
          }
        );
      });

      console.log(
        `[FlowBatchPilot] 下载已开始 (ID=${downloadId})`,
        safeFilename,
        "| taskIndex:",
        taskIndex,
        "| prompt:",
        prompt
      );

      sendResponse && sendResponse({ ok: true, downloadId });
    } catch (err) {
      console.error("[FlowBatchPilot] 下载失败：", err);
      sendResponse && sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true;
});

function sanitizeFilename(name) {
  let n = name || "flow_video.mp4";
  n = n.replace(/[\\/:*?"<>|]/g, "_");
  if (!n.trim()) n = "flow_video.mp4";
  return n;
}

