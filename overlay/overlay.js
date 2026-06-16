import { createPaintSketch } from './paint-sketch.js';

const promptCard = document.getElementById('prompt-card');
const promptText = document.getElementById('prompt-text');
const promptType = document.getElementById('prompt-type');
const container = document.getElementById('paint-container');

const sketch = createPaintSketch(container, {
  onPaintInComplete: () => {
    notifyBackground('PAINT_IN_DONE');
  },
  onPaintOutComplete: () => {
    notifyBackground('PAINT_OUT_DONE');
  },
  onReady: () => {
    signalReady();
  },
});

function getApi() {
  return sketch.getApi();
}

function signalReady() {
  window.parent.postMessage(
    { source: 'paint-pomodoro', event: 'READY' },
    '*',
  );
}

function showPrompt(prompt) {
  if (!prompt) {
    return;
  }
  promptType.textContent = prompt.type ?? 'rest';
  promptText.textContent = prompt.text ?? '';
  promptCard.hidden = false;
}

function hidePrompt() {
  promptCard.hidden = true;
  promptText.textContent = '';
  promptType.textContent = '';
}

function notifyBackground(type) {
  chrome.runtime.sendMessage({ type }).catch(() => {
    // Background may be asleep briefly.
  });
}

async function waitForApi(maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const api = getApi();
    if (api?.startPaintIn) {
      return api;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
}

async function handleCommand(command, payload = {}) {
  const api = await waitForApi();
  if (!api) {
    console.error('[PaintPomodoro overlay] Sketch API not ready');
    return;
  }

  switch (command) {
    case 'PING':
      signalReady();
      break;
    case 'RESIZE':
      sketch.instance?.windowResized?.();
      break;
    case 'PAINT_IN':
      hidePrompt();
      api.startPaintIn();
      break;
    case 'PAINT_OUT':
      hidePrompt();
      api.startPaintOut();
      break;
    case 'SHOW_PROMPT':
      showPrompt(payload.prompt);
      break;
    case 'PAUSE':
      api.pause();
      break;
    case 'RESUME':
      api.resume();
      break;
    case 'RESET':
      hidePrompt();
      api.reset();
      break;
    default:
      break;
  }
}

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'paint-pomodoro') {
    return;
  }
  handleCommand(event.data.command, event.data);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OVERLAY_COMMAND') {
    handleCommand(message.command, message);
  }
});

waitForApi().then((api) => {
  if (api) {
    signalReady();
  }
});
