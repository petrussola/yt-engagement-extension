import "./popup.css";

type DebugMessage =
  | { type: "youtube-engage-o-meter:getDebugDetails" }
  | { enabled: boolean; type: "youtube-engage-o-meter:setDebugDetails" };
type DebugResponse = {
  debugDetailsEnabled: boolean;
};

const debugToggle = document.querySelector<HTMLInputElement>(
  "#debug-details-toggle",
);
const debugStatus =
  document.querySelector<HTMLParagraphElement>("#debug-status");

function setStatus(message: string): void {
  if (debugStatus) {
    debugStatus.textContent = message;
  }
}

function setToggleEnabled(enabled: boolean): void {
  if (debugToggle) {
    debugToggle.disabled = !enabled;
  }
}

function getActiveTabId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (activeTab?.id === undefined) {
        reject(new Error("No active tab found."));
        return;
      }

      resolve(activeTab.id);
    });
  });
}

function sendDebugMessage(message: DebugMessage): Promise<DebugResponse> {
  return getActiveTabId().then(
    (tabId) =>
      new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (
            !response ||
            typeof response !== "object" ||
            !("debugDetailsEnabled" in response) ||
            typeof response.debugDetailsEnabled !== "boolean"
          ) {
            reject(new Error("No debug response received."));
            return;
          }

          resolve(response);
        });
      }),
  );
}

async function refreshDebugToggle(): Promise<void> {
  setToggleEnabled(false);
  setStatus("Checking current tab...");

  try {
    const response = await sendDebugMessage({
      type: "youtube-engage-o-meter:getDebugDetails",
    });

    if (debugToggle) {
      debugToggle.checked = response.debugDetailsEnabled;
    }

    setToggleEnabled(true);
    setStatus(
      response.debugDetailsEnabled
        ? "Debug details are enabled."
        : "Debug details are disabled.",
    );
  } catch {
    if (debugToggle) {
      debugToggle.checked = false;
    }

    setStatus("Open a YouTube watch page to use debug mode.");
  }
}

async function handleDebugToggleChange(): Promise<void> {
  if (!debugToggle) {
    return;
  }

  const nextEnabled = debugToggle.checked;
  setToggleEnabled(false);
  setStatus("Saving...");

  try {
    const response = await sendDebugMessage({
      enabled: nextEnabled,
      type: "youtube-engage-o-meter:setDebugDetails",
    });

    debugToggle.checked = response.debugDetailsEnabled;
    setStatus(
      response.debugDetailsEnabled
        ? "Debug details are enabled."
        : "Debug details are disabled.",
    );
    setToggleEnabled(true);
  } catch {
    await refreshDebugToggle();
  }
}

debugToggle?.addEventListener("change", () => {
  void handleDebugToggleChange();
});

void refreshDebugToggle();
