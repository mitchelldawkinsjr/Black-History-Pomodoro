// Placeholder for the paint overlay injector.
// Phase 2 will mount a fullscreen iframe here when focus ends.

const OVERLAY_ID = 'paint-pomodoro-overlay';

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
  iframe.style.cssText = [
    'position: fixed',
    'inset: 0',
    'width: 100vw',
    'height: 100vh',
    'border: none',
    'z-index: 2147483647',
    'pointer-events: none',
    'display: none',
  ].join(';');

  document.documentElement.appendChild(iframe);
  return iframe;
}

function showOverlay() {
  const iframe = createOverlayFrame();
  iframe.style.display = 'block';
  iframe.style.pointerEvents = 'all';
  iframe.setAttribute('aria-hidden', 'false');
}

function hideOverlay() {
  const iframe = document.getElementById(OVERLAY_ID);
  if (!iframe) {
    return;
  }
  iframe.style.display = 'none';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'OVERLAY_SHOW':
      showOverlay();
      break;
    case 'OVERLAY_HIDE':
      hideOverlay();
      break;
    default:
      break;
  }
});

// Expose helpers for future background script integration.
window.__paintPomodoro = {
  showOverlay,
  hideOverlay,
};
