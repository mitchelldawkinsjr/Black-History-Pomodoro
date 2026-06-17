const OVERLAY_ID = 'paint-pomodoro-overlay';

if (!globalThis.__paintPomodoroBridge) {
  globalThis.__paintPomodoroBridge = createOverlayBridge();
}

if (!globalThis.__paintPomodoroBridgeListener) {
  globalThis.__paintPomodoroBridgeListener = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    globalThis.__paintPomodoroBridge.handleMessage(message);
    sendResponse({ ok: true });
    return false;
  });
}

function createOverlayBridge() {
  let overlayReady = false;
  let pendingCommands = [];
  let retryInterval = null;

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
    iframe.setAttribute('title', 'Paint Pomodoro rest overlay');
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
    const iframe = createOverlayFrame();
    iframe.style.display = 'block';
    iframe.style.opacity = '1';
    iframe.style.pointerEvents = 'all';
    iframe.setAttribute('aria-hidden', 'false');

    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { source: 'paint-pomodoro', command: 'RESIZE' },
        '*',
      );
    }
  }

  function hideOverlay() {
    const iframe = document.getElementById(OVERLAY_ID);
    if (!iframe) {
      return;
    }
    iframe.style.display = 'none';
    iframe.style.opacity = '1';
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    overlayReady = false;
    pendingCommands = [];
    stopDeliveryRetry();
  }

  function forwardToOverlay(command, payload = {}) {
    const iframe = document.getElementById(OVERLAY_ID);
    if (!iframe?.contentWindow) {
      return false;
    }

    iframe.contentWindow.postMessage(
      {
        source: 'paint-pomodoro',
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
      createOverlayFrame();
      forwardToOverlay(command, payload);
      hideOverlay();
      return;
    }

    showOverlay();
    createOverlayFrame();
    queueCommand(command, payload);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'paint-pomodoro') {
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

      if (opacity <= 0.001) {
        hideOverlay();
      }
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
