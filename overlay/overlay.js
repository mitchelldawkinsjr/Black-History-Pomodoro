// Placeholder overlay logic — p5.js paint sketch will plug in here (Phase 2).

const canvas = document.getElementById('paint-canvas');
const promptCard = document.getElementById('prompt-card');
const promptText = document.getElementById('prompt-text');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function drawPlaceholder(label) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(196, 92, 74, 0.35)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
}

function showPrompt(text) {
  promptText.textContent = text;
  promptCard.hidden = false;
}

function hidePrompt() {
  promptCard.hidden = true;
  promptText.textContent = '';
}

window.addEventListener('resize', () => {
  resizeCanvas();
  drawPlaceholder('Paint overlay placeholder');
});

resizeCanvas();
drawPlaceholder('Paint overlay placeholder');

// Listen for commands from the content script / background (Phase 2).
window.addEventListener('message', (event) => {
  const { type, prompt } = event.data ?? {};

  switch (type) {
    case 'PAINT_IN':
      drawPlaceholder('Paint in…');
      break;
    case 'PAINT_OUT':
      drawPlaceholder('Paint out…');
      hidePrompt();
      break;
    case 'SHOW_PROMPT':
      showPrompt(prompt?.text ?? '');
      break;
    default:
      break;
  }
});

export { drawPlaceholder, hidePrompt, showPrompt };
