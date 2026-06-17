/**
 * Watercolor reveal — paints a Met artwork progressively via sampled grid marks.
 * Each break adds marks assigned to that break; unrevealed areas stay white.
 */

import {
  computeImageLayout,
  expandMark,
} from './mark-utils.js';

const DEFAULT_BREAK_MS = 5 * 60 * 1000;
const PAINT_OUT_MS = 25000;
const MAX_POOLS = 64;
const MAX_AGENTS = 1400;
const WHITE_PIGMENT = { r: 255, g: 252, b: 247 };

export function createPaintSketch(container, { onPaintInComplete, onPaintOutComplete, onReady } = {}) {
  const api = {};

  const instance = new p5((p) => {
    let wash;
    let pools = [];
    let tideOffset = 0;
    let mode = 'idle';
    let paintInDurationMs = DEFAULT_BREAK_MS;
    let paintInStart = 0;
    let paintOutStart = 0;
    let coverage = 0;
    let finishedPaintIn = false;
    let finishedPaintOut = false;
    let breakNumber = 1;
    let maxBreaks = 10;
    let useImageMode = false;
    let marksData = null;
    let markLayout = null;
    let breakMarks = [];
    let paintedMarkCount = 0;

    function screenDiagonal() {
      return p.sqrt(p.width * p.width + p.height * p.height);
    }

    function resetWash() {
      wash = p.createGraphics(p.width, p.height);
      wash.noStroke();
      wash.background(255, 255, 255);
    }

    function strokeScale(strength) {
      return p.lerp(0.5, 1, p.pow(strength, 0.75));
    }

    function shuffleArray(items) {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = p.floor(p.random(i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }

    function depositDab(g, x, y, radius, pigment, alpha, edgeBias = 0) {
      const layers = p.floor(p.random(3, 6));
      for (let layer = 0; layer < layers; layer += 1) {
        const t = layer / layers;
        const r = radius * (1 - t * 0.72) * p.random(0.82, 1.18);
        const a = alpha * (1 - t * 0.45) * p.random(0.75, 1.2);

        g.fill(pigment.r, pigment.g, pigment.b, a * (1 - edgeBias * 0.25));
        g.beginShape();
        const verts = p.floor(p.random(7, 13));
        for (let v = 0; v < verts; v += 1) {
          const ang = (p.TWO_PI / verts) * v + p.random(-0.35, 0.35);
          const n = p.noise(
            x * 0.011 + p.cos(ang) * 0.4,
            y * 0.011 + p.sin(ang) * 0.4,
            layer + v * 0.07,
          );
          const wobble = 0.28 + n * 0.92;
          const rx = r * wobble * p.random(0.85, 1.2);
          const ry = r * wobble * p.random(0.65, 1.35);
          g.vertex(x + p.cos(ang) * rx, y + p.sin(ang) * ry);
        }
        g.endShape(p.CLOSE);
      }
    }

    function depositImageMark(g, mark) {
      const { x, y, w, h, rotation, pigment } = mark;
      const alpha = p.random(5, 11);

      g.push();
      g.translate(x, y);
      g.rotate(rotation + p.random(-0.25, 0.25));

      const scaleX = w / Math.max(w, h);
      const scaleY = h / Math.max(w, h);
      g.scale(scaleX, scaleY);

      depositDab(g, 0, 0, Math.max(w, h) * 0.42, pigment, alpha);
      depositDab(
        g,
        p.random(-2.5, 2.5),
        p.random(-2.5, 2.5),
        Math.max(w, h) * p.random(0.22, 0.38),
        pigment,
        alpha * p.random(0.35, 0.6),
      );
      g.pop();
    }

    function applyPaperTexture(g, strength) {
      const count = p.floor(p.map(strength, 0, 1, 2, 6));
      for (let i = 0; i < count; i += 1) {
        const x = p.random(p.width);
        const y = p.random(p.height);
        depositDab(
          g,
          x,
          y,
          p.random(18, 55),
          WHITE_PIGMENT,
          p.random(0.4, 1.2) * strength,
        );
      }
    }

    function prepareImageBreakMarks() {
      if (!marksData?.marks?.length) {
        return [];
      }

      markLayout = computeImageLayout(
        marksData.sampleWidth,
        marksData.sampleHeight,
        p.width,
        p.height,
      );
      markLayout.gridSize = marksData.gridSize;

      const expanded = marksData.marks.map((compact) => expandMark(compact, markLayout));
      return shuffleArray(expanded);
    }

    function paintImageMarksUpTo(targetCount) {
      const end = p.min(targetCount, breakMarks.length);
      while (paintedMarkCount < end) {
        depositImageMark(wash, breakMarks[paintedMarkCount]);
        paintedMarkCount += 1;
      }
    }

    function pigmentFor(x, y, seed = 0) {
      const n = p.noise(x * 0.003, y * 0.003, seed);
      return {
        r: p.constrain(95 + n * 115 + p.random(-10, 10), 80, 220),
        g: p.constrain(72 + p.noise(x * 0.005, y * 0.008, seed + 40) * 100, 58, 190),
        b: p.constrain(62 + p.noise(x * 0.004, y * 0.006, seed + 80) * 110, 50, 185),
      };
    }

    function depositOrganicStroke(g, x, y, radius, alpha, edgeBias, huePigment) {
      depositDab(g, x, y, radius, huePigment, alpha, edgeBias);
    }

    class BleedAgent {
      constructor(x, y, pool) {
        this.x = x;
        this.y = y;
        this.pool = pool;
        this.z = p.random(1000);
        this.speed = p.random(1.0, 3.2);
        this.wetness = p.random(0.6, 1);
        this.radius = p.random(6, 18);
        this.life = p.floor(p.random(130, 300));
        this.age = 0;
      }

      alive() {
        return this.age < this.life;
      }

      step(g, scale) {
        this.age += 1;
        const flowAngle =
          p.noise(this.x * 0.0028, this.y * 0.0028, this.z) * p.TWO_PI * 2.4 +
          p.noise(this.pool.seed, this.z * 0.5) * 0.9;
        const meander = p.map(
          p.noise(this.x * 0.008, this.y * 0.008, this.z * 1.7),
          0,
          1,
          -1.4,
          1.4,
        );
        const dir = flowAngle + meander + this.pool.driftAngle;
        const pace = this.speed * this.wetness * p.lerp(0.65, 1, scale);
        this.x += p.cos(dir) * pace;
        this.y += p.sin(dir) * pace;
        this.z += p.random(0.005, 0.014);
        this.x += p.random(-1.4, 1.4) * scale;
        this.y += p.random(-1.4, 1.4) * scale;

        const fade = 1 - this.age / this.life;
        const growth = p.lerp(0.55, 1, this.age / this.life);
        const alpha = p.random(3.5, 8.5) * fade * this.wetness;
        const size = this.radius * growth * scale * p.random(0.85, 1.4);
        depositOrganicStroke(g, this.x, this.y, size, alpha, 0, this.pool.pigment);
      }
    }

    class PaintPool {
      constructor(x, y, options = {}) {
        this.x = x;
        this.y = y;
        this.seed = p.random(10000);
        this.driftAngle = options.driftAngle ?? p.random(-0.4, 0.4);
        this.urgency = options.urgency ?? 1;
        this.agents = [];
        this.age = 0;
        this.life = p.floor(p.random(260, 480));
        this.spawnRate = p.random(0.48, 0.85);
        this.pigment = pigmentFor(x, y, this.seed);
        this.maxSpread = screenDiagonal() * p.random(0.45, 0.75) * this.urgency;

        const initial = p.floor(p.random(8, 18) * this.urgency);
        for (let i = 0; i < initial; i += 1) {
          this.spawnAgent(x + p.random(-24, 24), y + p.random(-24, 24), 0.85);
        }
      }

      spawnAgent(x, y, wetnessScale = 1) {
        if (this.agents.length >= MAX_AGENTS / MAX_POOLS) {
          return;
        }
        const agent = new BleedAgent(x, y, this);
        agent.wetness *= wetnessScale;
        agent.radius *= 0.9 + this.urgency * 0.12;
        this.agents.push(agent);
      }

      alive() {
        return this.age < this.life || this.agents.some((a) => a.alive());
      }

      update(g, soakStrength) {
        this.age += 1;
        const scale = strokeScale(soakStrength);

        if (this.age < this.life && p.random() < this.spawnRate * soakStrength) {
          const spread = p.lerp(14, this.maxSpread, p.pow(this.age / this.life, 0.6)) * scale;
          for (let i = 0; i < p.floor(p.random(2, 5)); i += 1) {
            const angle = p.random(p.TWO_PI);
            const dist = p.random(0, spread) * p.sqrt(p.random());
            this.spawnAgent(this.x + p.cos(angle) * dist, this.y + p.sin(angle) * dist, p.random(0.5, 1));
          }
        }

        this.agents = this.agents.filter((agent) => agent.alive());
        for (const agent of this.agents) {
          agent.step(g, scale);
        }
      }
    }

    function randomSoakPoint() {
      return {
        x: p.random(p.width),
        y: p.random(p.height),
        driftAngle: p.random(-0.5, 0.5),
        urgency: p.random(0.95, 1.35),
      };
    }

    function spawnPools(count) {
      for (let i = 0; i < count; i += 1) {
        if (pools.length >= MAX_POOLS) {
          pools.shift();
        }
        const point = randomSoakPoint();
        pools.push(new PaintPool(point.x, point.y, point));
      }
    }

    function exportWash() {
      if (!wash?.canvas) {
        return null;
      }
      return wash.canvas.toDataURL('image/jpeg', 0.92);
    }

    function loadPreviousCanvas(dataUrl) {
      return new Promise((resolve) => {
        if (!dataUrl) {
          resolve(false);
          return;
        }
        p.loadImage(
          dataUrl,
          (img) => {
            wash.clear();
            wash.background(255);
            wash.image(img, 0, 0, p.width, p.height);
            resolve(true);
          },
          () => resolve(false),
        );
      });
    }

    function drawComposite() {
      if (wash) {
        p.image(wash, 0, 0);
      } else {
        p.background(255);
      }
    }

    function sealBreakLayer() {
      if (useImageMode) {
        applyPaperTexture(wash, 0.35);
        return;
      }

      for (let i = 0; i < 8; i += 1) {
        const point = randomSoakPoint();
        const pool = new PaintPool(point.x, point.y, { ...point, urgency: 1.2 });
        pool.life = 60;
        pools.push(pool);
      }
    }

    function finishPaintIn() {
      if (finishedPaintIn) {
        return;
      }
      finishedPaintIn = true;

      if (useImageMode) {
        paintImageMarksUpTo(breakMarks.length);
      }

      sealBreakLayer();
      pools = [];
      mode = 'resting';
      drawComposite();
      p.noLoop();
      onPaintInComplete?.(exportWash());
    }

    function finishPaintOut() {
      if (finishedPaintOut) {
        return;
      }
      finishedPaintOut = true;
      mode = 'idle';
      onPaintOutComplete?.();
    }

    function updateImagePaintIn(elapsed) {
      coverage = p.min(1, elapsed / paintInDurationMs);
      const targetCount = p.floor(coverage * breakMarks.length);
      const batchSize = p.max(1, p.ceil((targetCount - paintedMarkCount) / 5));

      for (let i = 0; i < batchSize; i += 1) {
        if (paintedMarkCount >= targetCount) {
          break;
        }
        paintImageMarksUpTo(paintedMarkCount + 1);
      }

      if (p.frameCount % 18 === 0) {
        applyPaperTexture(wash, 0.12);
      }
    }

    function updateGenerativePaintIn(elapsed) {
      coverage = p.min(1, elapsed / paintInDurationMs);
      const soakStrength = p.pow(coverage, 0.72);

      if (p.frameCount % p.floor(p.map(coverage, 0, 1, 5, 12)) === 0) {
        spawnPools(p.floor(p.random(2, 4)));
      }

      pools = pools.filter((pool) => pool.alive());
      for (const pool of pools) {
        pool.update(wash, soakStrength);
      }
    }

    p.setup = () => {
      const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
      canvas.parent(container);
      p.pixelDensity(1);
      p.noStroke();
      resetWash();
      p.noLoop();
      onReady?.();
    };

    p.draw = () => {
      if (mode === 'idle') {
        p.clear();
        return;
      }

      if (mode === 'resting') {
        drawComposite();
        return;
      }

      if (mode === 'paintIn') {
        const elapsed = p.millis() - paintInStart;

        if (useImageMode) {
          updateImagePaintIn(elapsed);
        } else {
          updateGenerativePaintIn(elapsed);
        }

        if (elapsed >= paintInDurationMs) {
          finishPaintIn();
        }
      }

      if (mode === 'paintOut') {
        const elapsed = p.millis() - paintOutStart;
        const progress = p.min(1, elapsed / PAINT_OUT_MS);

        for (let i = 0; i < 6; i += 1) {
          const lx = p.random(p.width);
          const ly = p.random(p.height);
          const lift = progress * p.max(p.width, p.height) * p.random(0.12, 0.38);
          for (let r = lift; r > 0; r -= lift / 6) {
            wash.fill(255, 252, 248, p.random(5, 14));
            wash.beginShape();
            const verts = p.floor(p.random(8, 14));
            for (let v = 0; v < verts; v += 1) {
              const ang = (p.TWO_PI / verts) * v + p.random(-0.3, 0.3);
              const wobble = p.noise(lx * 0.009, ly * 0.009, v + progress * 4) * 0.45;
              const rad = r * (0.65 + wobble);
              wash.vertex(lx + p.cos(ang) * rad, ly + p.sin(ang) * rad);
            }
            wash.endShape(p.CLOSE);
          }
        }

        wash.fill(255, 255, 255, progress * 9 + 0.4);
        wash.rect(0, 0, p.width, p.height);

        if (progress >= 1) {
          finishPaintOut();
        }
      }

      drawComposite();
    };

    p.windowResized = () => {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      const snapshot = wash.get();
      resetWash();
      wash.image(snapshot, 0, 0);
      if (useImageMode && marksData && mode === 'paintIn') {
        const prevProgress = breakMarks.length ? paintedMarkCount / breakMarks.length : 0;
        breakMarks = prepareImageBreakMarks();
        paintedMarkCount = p.floor(prevProgress * breakMarks.length);
      }
    };

    api.startPaintIn = async (options = {}) => {
      const w = p.windowWidth || window.innerWidth || screen.width;
      const h = p.windowHeight || window.innerHeight || screen.height;
      p.resizeCanvas(w, h);

      breakNumber = options.breakNumber ?? 1;
      maxBreaks = options.maxBreaks ?? 10;
      paintInDurationMs = options.breakDurationMs ?? DEFAULT_BREAK_MS;
      marksData = options.marks ?? null;
      useImageMode = Boolean(marksData?.marks?.length);

      mode = 'paintIn';
      paintInStart = p.millis();
      paintOutStart = 0;
      coverage = 0;
      finishedPaintIn = false;
      finishedPaintOut = false;
      tideOffset = p.random(100);
      pools = [];
      paintedMarkCount = 0;
      breakMarks = [];
      resetWash();

      if (options.previousCanvas) {
        await loadPreviousCanvas(options.previousCanvas);
      }

      if (useImageMode) {
        breakMarks = prepareImageBreakMarks();
      } else {
        spawnPools(p.floor(p.map(breakNumber, 1, maxBreaks, 5, 8)));
      }

      p.loop();
    };

    api.startPaintOut = () => {
      if (mode === 'paintIn' && !finishedPaintIn) {
        finishPaintIn();
      }
      mode = 'paintOut';
      paintOutStart = p.millis();
      finishedPaintOut = false;
      pools = [];
      p.loop();
    };

    api.pause = () => {
      p.noLoop();
    };

    api.resume = () => {
      if (mode !== 'idle') {
        p.loop();
      }
    };

    api.reset = () => {
      mode = 'idle';
      pools = [];
      coverage = 0;
      finishedPaintIn = false;
      finishedPaintOut = false;
      useImageMode = false;
      marksData = null;
      breakMarks = [];
      paintedMarkCount = 0;
      resetWash();
      p.clear();
      p.noLoop();
    };

    api.getMode = () => mode;
  }, container);

  return {
    instance,
    getApi: () => api,
  };
}
