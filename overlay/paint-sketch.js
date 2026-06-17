/**
 * Watercolor reveal — dense overlapping splotches build the painting in ~20s, then hold.
 */

import {
  computeImageLayout,
  expandMark,
} from './mark-utils.js';
import { createWatercolorTools } from './watercolor.js';
import { createColorAgents } from './color-agents.js';

const DEFAULT_PAINT_MS = 20 * 1000;
const PAINT_OUT_MS = 4200;
const MAX_FALLBACK_POOLS = 64;

export function createPaintSketch(container, { onPaintInComplete, onPaintOutComplete, onPaintOutProgress, onReady } = {}) {
  const api = {};

  const instance = new p5((p) => {
    const wc = createWatercolorTools(p);
    const colorAgents = createColorAgents(p, wc);

    let wash;
    let fallbackPools = [];
    let mode = 'idle';
    let paintInDurationMs = DEFAULT_PAINT_MS;
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
    let previousCanvasImage = null;
    let paperFade = 1;
    let overlayOpacity = 1;

    function getArtworkImageUrl(artwork) {
      return artwork?.primaryImage || artwork?.primaryImageSmall || null;
    }

    function initColorAgents(img) {
      if (!marksData || !markLayout) {
        return;
      }

      const scale = p.max(1, p.sqrt((p.width * p.height) / (900 * 700)));
      colorAgents.initFromImage(img, marksData, markLayout, {
        penQuantity: p.floor(p.map(breakNumber, 1, maxBreaks, 22, 34) * p.min(scale, 1.35)),
        agentRange: p.floor(p.map(breakNumber, 1, maxBreaks, 10, 14)),
        brushRadius: p.lerp(2.8, 4.2, breakNumber / maxBreaks),
        brushAlpha: p.lerp(5.5, 8.5, breakNumber / maxBreaks),
      });
    }

    function resetWash(transparent = false) {
      wash = p.createGraphics(p.width, p.height);
      wash.noStroke();
      if (transparent) {
        wash.clear();
      } else {
        wash.background(255, 255, 255);
      }
    }

    function getPaperFadeMs() {
      return p.min(4000, p.max(2200, paintInDurationMs * 0.18));
    }

    function updatePaperFade(elapsed) {
      const raw = p.min(1, elapsed / getPaperFadeMs());
      paperFade = p.pow(raw, 0.72);
    }

    function updatePaintOutFade(elapsed) {
      const progress = p.min(1, elapsed / PAINT_OUT_MS);
      const remaining = p.pow(1 - progress, 0.82);
      overlayOpacity = remaining;
      paperFade = remaining;
      onPaintOutProgress?.(remaining);
    }

    function flattenWashForExport() {
      const flat = p.createGraphics(p.width, p.height);
      flat.noStroke();
      flat.background(255);
      if (previousCanvasImage) {
        flat.image(previousCanvasImage, 0, 0, p.width, p.height);
      }
      if (wash) {
        flat.image(wash, 0, 0);
      }
      wash = flat;
      previousCanvasImage = null;
      paperFade = 1;
    }

    function breakRichness() {
      return p.lerp(0.88, 0.98, p.pow(breakNumber / maxBreaks, 0.45));
    }

    function sortMarksCenterOut(marks) {
      if (!markLayout) {
        return marks;
      }
      const cx = markLayout.offsetX + markLayout.drawW * 0.5;
      const cy = markLayout.offsetY + markLayout.drawH * 0.5;
      return marks.slice().sort((a, b) => {
        const da = p.dist(a.x, a.y, cx, cy) + p.random(-10, 10);
        const db = p.dist(b.x, b.y, cx, cy) + p.random(-10, 10);
        return da - db;
      });
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
      return sortMarksCenterOut(expanded);
    }

    function paintSingleMark(mark, sessionOpacity) {
      wc.depositSplotch(wash, mark, breakRichness(), sessionOpacity);
    }

    function createFallbackPool(x, y) {
      return {
        x,
        y,
        pigment: {
          r: p.random(90, 200),
          g: p.random(70, 170),
          b: p.random(60, 160),
        },
        driftAngle: p.random(-0.5, 0.5),
        agents: [],
        age: 0,
        life: p.floor(p.random(200, 360)),
        spawnRate: p.random(0.4, 0.7),
        maxAgents: 10,
        spawnAgent(ax, ay, wetness = 1) {
          if (this.agents.length >= this.maxAgents) {
            return;
          }
          const agent = {
            x: ax,
            y: ay,
            pool: this,
            z: p.random(1000),
            speed: p.random(0.8, 2.4),
            wetness,
            radius: p.random(5, 14),
            life: p.floor(p.random(100, 220)),
            age: 0,
            alive() {
              return this.age < this.life;
            },
            step(g, agentScale) {
              this.age += 1;
              const dir = p.noise(this.x * 0.003, this.y * 0.003, this.z) * p.TWO_PI * 2;
              this.x += p.cos(dir) * this.speed * agentScale;
              this.y += p.sin(dir) * this.speed * agentScale;
              const fade = 1 - this.age / this.life;
              wc.depositDab(g, this.x, this.y, this.radius * fade, this.pool.pigment, p.random(3, 7) * fade);
            },
          };
          this.agents.push(agent);
        },
        alive() {
          return this.age < this.life || this.agents.some((a) => a.alive());
        },
        update(g, poolScale) {
          this.age += 1;
          if (this.age < this.life && p.random() < this.spawnRate * poolScale) {
            this.spawnAgent(this.x + p.random(-20, 20), this.y + p.random(-20, 20));
          }
          this.agents = this.agents.filter((a) => a.alive());
          for (const agent of this.agents) {
            agent.step(g, poolScale);
          }
        },
      };
    }

    function spawnFallbackPools(count) {
      for (let i = 0; i < count; i += 1) {
        if (fallbackPools.length >= MAX_FALLBACK_POOLS) {
          fallbackPools.shift();
        }
        fallbackPools.push(createFallbackPool(p.random(p.width), p.random(p.height)));
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
          previousCanvasImage = null;
          resolve(false);
          return;
        }
        p.loadImage(
          dataUrl,
          (img) => {
            previousCanvasImage = img;
            resolve(true);
          },
          () => {
            previousCanvasImage = null;
            resolve(false);
          },
        );
      });
    }

    function drawComposite() {
      p.clear();

      if (overlayOpacity <= 0.001) {
        return;
      }

      if (paperFade > 0) {
        p.noStroke();
        p.fill(255, 255, 255, paperFade * overlayOpacity * 255);
        p.rect(0, 0, p.width, p.height);
      }

      if (previousCanvasImage && paperFade > 0) {
        p.tint(255, paperFade * overlayOpacity * 255);
        p.image(previousCanvasImage, 0, 0, p.width, p.height);
        p.noTint();
      }

      if (wash) {
        p.tint(255, overlayOpacity * 255);
        p.image(wash, 0, 0);
        p.noTint();
      }
    }

    function finishPaintIn() {
      if (finishedPaintIn) {
        return;
      }
      finishedPaintIn = true;

      if (useImageMode) {
        const sessionOpacity = p.random(0.88, 0.98);
        while (paintedMarkCount < breakMarks.length) {
          paintSingleMark(breakMarks[paintedMarkCount], sessionOpacity);
          paintedMarkCount += 1;
        }
      }

      if (colorAgents.isReady()) {
        colorAgents.burst(wash, p.floor(p.map(breakNumber, 1, maxBreaks, 80, 140)), 0.95);
      }

      flattenWashForExport();
      fallbackPools = [];
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
      overlayOpacity = 0;
      paperFade = 0;
      mode = 'idle';
      p.clear();
      p.noLoop();
      onPaintOutProgress?.(0);
      onPaintOutComplete?.();
    }

    function updateImagePaintIn(elapsed) {
      coverage = p.min(1, elapsed / paintInDurationMs);
      const sessionOpacity = p.lerp(0.52, 0.94, p.pow(coverage, 0.38));
      const targetCount = p.floor(coverage * breakMarks.length);
      const remaining = targetCount - paintedMarkCount;
      const splotchWeight = colorAgents.isReady() ? 0.42 : 1;
      const batchSize = p.max(
        6,
        p.floor(
          p.min(remaining, p.ceil(remaining * 0.45) + 8) * splotchWeight,
        ),
      );

      for (let i = 0; i < batchSize && paintedMarkCount < targetCount; i += 1) {
        paintSingleMark(breakMarks[paintedMarkCount], sessionOpacity);
        paintedMarkCount += 1;
      }

      if (colorAgents.isReady()) {
        const agentSteps = p.floor(p.map(coverage, 0, 1, 1, 3));
        const agentAlpha = sessionOpacity * p.lerp(0.55, 1, p.pow(coverage, 0.5));
        colorAgents.step(wash, agentSteps, agentAlpha);
      }
    }

    function updateGenerativePaintIn(elapsed) {
      coverage = p.min(1, elapsed / paintInDurationMs);
      const soakStrength = p.pow(coverage, 0.72);

      if (p.frameCount % p.floor(p.map(coverage, 0, 1, 5, 12)) === 0) {
        spawnFallbackPools(p.floor(p.random(2, 4)));
      }

      fallbackPools = fallbackPools.filter((pool) => pool.alive());
      for (const pool of fallbackPools) {
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

        updatePaperFade(elapsed);

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
        updatePaintOutFade(elapsed);
        drawComposite();

        if (elapsed >= PAINT_OUT_MS) {
          finishPaintOut();
        }
        return;
      }

      drawComposite();
    };

    p.windowResized = () => {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      const snapshot = wash.get();
      resetWash(mode === 'paintIn');
      wash.image(snapshot, 0, 0, p.width, p.height);
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
      paintInDurationMs = options.paintDurationMs ?? DEFAULT_PAINT_MS;
      marksData = options.marks ?? null;
      useImageMode = Boolean(marksData?.marks?.length);

      mode = 'paintIn';
      paintInStart = p.millis();
      paintOutStart = 0;
      coverage = 0;
      finishedPaintIn = false;
      finishedPaintOut = false;
      fallbackPools = [];
      paintedMarkCount = 0;
      breakMarks = [];
      previousCanvasImage = null;
      paperFade = 0;
      overlayOpacity = 1;
      resetWash(true);

      if (options.previousCanvas) {
        await loadPreviousCanvas(options.previousCanvas);
      }

      if (useImageMode) {
        breakMarks = prepareImageBreakMarks();
        const artwork = options.artwork ?? null;
        if (artwork) {
          const url = getArtworkImageUrl(artwork);
          if (url) {
            await new Promise((resolve) => {
              p.loadImage(
                url,
                (img) => {
                  initColorAgents(img);
                  resolve();
                },
                () => resolve(),
              );
            });
          }
        }
      } else {
        colorAgents.reset();
        spawnFallbackPools(p.floor(p.map(breakNumber, 1, maxBreaks, 5, 8)));
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
      overlayOpacity = 1;
      paperFade = 1;
      fallbackPools = [];
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
      fallbackPools = [];
      coverage = 0;
      finishedPaintIn = false;
      finishedPaintOut = false;
      useImageMode = false;
      marksData = null;
      breakMarks = [];
      paintedMarkCount = 0;
      previousCanvasImage = null;
      paperFade = 1;
      overlayOpacity = 1;
      colorAgents.reset();
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
