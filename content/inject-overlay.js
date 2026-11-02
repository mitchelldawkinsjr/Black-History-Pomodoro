const OVERLAY_ID = 'black-history-pomodoro-overlay';

if (!globalThis.__blackHistoryPomodoroBridge) {
  globalThis.__blackHistoryPomodoroBridge = createOverlayBridge();
}

if (!globalThis.__blackHistoryPomodoroBridgeListener) {
  globalThis.__blackHistoryPomodoroBridgeListener = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    globalThis.__blackHistoryPomodoroBridge.handleMessage(message);
    sendResponse({ ok: true });
    return false;
  });
}

function createOverlayBridge() {
  let overlayReady = false;
  let pendingCommands = [];
  let retryInterval = null;
  /** True after focus/reset tears the painting down. Blocks late commands from bringing it back. */
  let dismissed = false;

  const REVEAL_COMMANDS = new Set(['START_BREAK', 'PAINT_IN', 'PAINT_OUT']);

  function overlayExists() {
    return document.getElementById(OVERLAY_ID) !== null;
  }

  function createOverlayFrame() {
    if (overlayExists()) {
      return document.getElementById(OVERLAY_ID);
    }

    const iframe = document.createElement('iframe');
    iframe.id = OVERLAY_ID;
    iframe.src = chrome.runtime.getURL('overlay/overlay.html');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('title', 'Black History Pomodoro rest overlay');
    iframe.style.cssText = [
      'position: fixed',
      'inset: 0',
      'width: 100vw',
      'height: 100vh',
      'border: none',
      'z-index: 2147483647',
      'pointer-events: none',
      'display: none',
      'background: transparent',
    ].join(';');

    iframe.addEventListener(
      'load',
      () => {
        if (!iframe.isConnected || dismissed) {
          return;
        }
        iframe.dataset.loaded = 'true';
        overlayReady = false;
        startDeliveryRetry();
      },
      { once: false },
    );

    document.documentElement.appendChild(iframe);
    return iframe;
  }

  function showOverlay() {
    dismissed = false;
    const iframe = createOverlayFrame();
    iframe.style.setProperty('display', 'block', 'important');
    iframe.style.setProperty('visibility', 'visible', 'important');
    iframe.style.setProperty('opacity', '1', 'important');
    iframe.style.setProperty('pointer-events', 'all', 'important');
    iframe.setAttribute('aria-hidden', 'false');

    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { source: 'black-history-pomodoro', command: 'RESIZE' },
        '*',
      );
    }
  }

  function hideOverlay() {
    // Drop the iframe entirely so the decoded painting is released, including
    // when the page forces iframes visible with !important.
    dismissed = true;
    overlayReady = false;
    pendingCommands = [];
    stopDeliveryRetry();

    const iframe = document.getElementById(OVERLAY_ID);
    if (!iframe) {
      return;
    }

    try {
      iframe.contentWindow?.postMessage(
        { source: 'black-history-pomodoro', command: 'RESET' },
        '*',
      );
    } catch {
      // Frame is already detached.
    }

    iframe.style.setProperty('display', 'none', 'important');
    iframe.style.setProperty('visibility', 'hidden', 'important');
    iframe.style.setProperty('opacity', '0', 'important');
    iframe.style.setProperty('pointer-events', 'none', 'important');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.remove();
  }

  function forwardToOverlay(command, payload = {}) {
    const iframe = document.getElementById(OVERLAY_ID);
    if (!iframe?.contentWindow) {
      return false;
    }

    iframe.contentWindow.postMessage(
      {
        source: 'black-history-pomodoro',
        command,
        ...payload,
      },
      '*',
    );
    return true;
  }

  function flushPendingCommands() {
    if (!overlayReady || pendingCommands.length === 0) {
      return;
    }

    const queue = pendingCommands.splice(0);
    for (const { command, payload } of queue) {
      forwardToOverlay(command, payload);
    }
  }

  function queueCommand(command, payload = {}) {
    pendingCommands.push({ command, payload });
    flushPendingCommands();
    startDeliveryRetry();
  }

  function stopDeliveryRetry() {
    if (retryInterval) {
      clearInterval(retryInterval);
      retryInterval = null;
    }
  }

  function startDeliveryRetry() {
    if (retryInterval) {
      return;
    }

    let attempts = 0;
    retryInterval = setInterval(() => {
      attempts += 1;

      if (overlayReady) {
        flushPendingCommands();
        if (pendingCommands.length === 0) {
          stopDeliveryRetry();
        }
        return;
      }

      forwardToOverlay('PING');

      if (attempts >= 40) {
        stopDeliveryRetry();
      }
    }, 200);
  }

  function deliverOverlayCommand(command, payload = {}) {
    if (command === 'RESET') {
      hideOverlay();
      return;
    }

    if (REVEAL_COMMANDS.has(command)) {
      showOverlay();
      queueCommand(command, payload);
      return;
    }

    // Pause, resume, and checkpoint must not recreate the painting after focus starts.
    if (dismissed || !overlayExists()) {
      return;
    }

    queueCommand(command, payload);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'black-history-pomodoro') {
      return;
    }

    if (event.data.event === 'READY') {
      overlayReady = true;
      flushPendingCommands();
      if (pendingCommands.length === 0) {
        stopDeliveryRetry();
      }
      return;
    }

    if (event.data.event === 'FADE') {
      const iframe = document.getElementById(OVERLAY_ID);
      if (!iframe) {
        return;
      }
      const opacity = Math.max(0, Math.min(1, event.data.opacity ?? 1));
      iframe.style.opacity = String(opacity);
      iframe.style.pointerEvents = opacity < 1 ? 'none' : 'all';
      // Do not hide on fade — hiding pauses the iframe rAF loop and can
      // prevent PAINT_OUT_DONE from ever firing (stuck "Returning…" state).
      // Overlay is removed via the explicit HIDE event after paint-out completes.
      return;
    }

    if (event.data.event === 'HIDE') {
      hideOverlay();
    }
  });

  function handleMessage(message) {
    switch (message.type) {
      case 'OVERLAY_SHOW':
        showOverlay();
        break;
      case 'OVERLAY_HIDE':
        hideOverlay();
        break;
      case 'OVERLAY_COMMAND':
        deliverOverlayCommand(message.command, message);
        break;
      default:
        break;
    }
  }

  return { handleMessage, showOverlay, hideOverlay };
}
