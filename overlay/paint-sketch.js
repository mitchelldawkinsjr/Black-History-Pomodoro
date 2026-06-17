/**
 * Watercolor reveal — dense overlapping splotches build the painting in ~20s, then hold.
 */

import {
  computeImageLayout,
  expandMark,
} from './mark-utils.js';
import { createWatercolorTools } from './watercolor.js';

const DEFAULT_PAINT_MS = 20 * 1000;
const PAINT_OUT_MS = 25000;
const MAX_FALLBACK_POOLS = 64;

export function createPaintSketch(container, { onPaintInComplete, onPaintOutComplete, onReady } = {}) {
  const api = {};

  const instance = new p5((p) => {
    const wc = createWatercolorTools(p);

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

    function resetWash() {
      wash = p.createGraphics(p.width, p.height);
      wash.noStroke();
      wash.background(255, 255, 255);
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
      mode = 'idle';
      onPaintOutComplete?.();
    }

    function updateImagePaintIn(elapsed) {
      coverage = p.min(1, elapsed / paintInDurationMs);
      const sessionOpacity = p.lerp(0.52, 0.94, p.pow(coverage, 0.38));
      const targetCount = p.floor(coverage * breakMarks.length);
      const remaining = targetCount - paintedMarkCount;
      const batchSize = p.max(
        10,
        p.min(remaining, p.ceil(remaining * 0.45) + 8),
      );

      for (let i = 0; i < batchSize && paintedMarkCount < targetCount; i += 1) {
        paintSingleMark(breakMarks[paintedMarkCount], sessionOpacity);
        paintedMarkCount += 1;
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
      resetWash();

      if (options.previousCanvas) {
        await loadPreviousCanvas(options.previousCanvas);
      }

      if (useImageMode) {
        breakMarks = prepareImageBreakMarks();
      } else {
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
