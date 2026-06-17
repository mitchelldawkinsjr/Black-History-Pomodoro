/**
 * Watercolor wash — organic trails across the full screen.
 * Daily progression: color grows from center outward; outer strokes stay white/cream.
 * Canvas persists as a full composite between breaks.
 */

const PAINT_IN_MS = 28000;
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
    let paintInStart = 0;
    let paintOutStart = 0;
    let coverage = 0;
    let finishedPaintIn = false;
    let finishedPaintOut = false;
    let breakNumber = 1;
    let maxBreaks = 10;

    function screenDiagonal() {
      return p.sqrt(p.width * p.width + p.height * p.height);
    }

    function colorProgress() {
      return p.constrain(breakNumber / maxBreaks, 0.08, 1);
    }

    function isColoredRegion(x, y) {
      const cx = p.width * 0.5;
      const cy = p.height * 0.5;
      const dist = p.dist(x, y, cx, cy);
      const maxDist = screenDiagonal() * 0.5;
      const normalized = dist / maxDist;
      const wobble =
        (p.noise(x * 0.0032, y * 0.0032, tideOffset + breakNumber) - 0.5) * 0.16;
      return normalized <= colorProgress() + wobble;
    }

    function resetWash() {
      wash = p.createGraphics(p.width, p.height);
      wash.noStroke();
      wash.background(255, 255, 255);
    }

    function strokeScale(strength) {
      return p.lerp(0.5, 1, p.pow(strength, 0.75));
    }

    function pigmentFor(x, y, seed = 0) {
      const n = p.noise(x * 0.003, y * 0.003, seed);
      return {
        r: p.constrain(95 + n * 115 + p.random(-10, 10), 80, 220),
        g: p.constrain(72 + p.noise(x * 0.005, y * 0.008, seed + 40) * 100, 58, 190),
        b: p.constrain(62 + p.noise(x * 0.004, y * 0.006, seed + 80) * 110, 50, 185),
      };
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

        if (edgeBias > 0.2 && pigment !== WHITE_PIGMENT) {
          g.noFill();
          g.stroke(pigment.r * 0.85, pigment.g * 0.85, pigment.b * 0.85, a * edgeBias * 0.55);
          g.strokeWeight(p.random(0.4, 1.2));
          g.beginShape();
          for (let v = 0; v < verts; v += 1) {
            const ang = (p.TWO_PI / verts) * v + p.random(-0.25, 0.25);
            const n = p.noise(x * 0.011 + p.cos(ang), y * 0.011 + p.sin(ang), layer);
            const rad = r * (0.55 + n * 0.55);
            g.vertex(x + p.cos(ang) * rad, y + p.sin(ang) * rad * p.random(0.8, 1.15));
          }
          g.endShape(p.CLOSE);
          g.noStroke();
        }
      }
    }

    function depositOrganicStroke(g, x, y, radius, alpha, edgeBias, huePigment) {
      if (isColoredRegion(x, y)) {
        depositDab(g, x, y, radius, huePigment, alpha, edgeBias);
      } else {
        depositDab(g, x, y, radius * p.random(0.85, 1.15), WHITE_PIGMENT, alpha * p.random(0.25, 0.55), 0);
      }
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

        const edge = this.pool.edgeBias(this.x, this.y);
        const fade = 1 - this.age / this.life;
        const growth = p.lerp(0.55, 1, this.age / this.life);
        const alpha = p.random(3.5, 8.5) * fade * this.wetness;
        const size = this.radius * growth * scale * p.random(0.85, 1.4);

        depositOrganicStroke(g, this.x, this.y, size, alpha, edge, this.pool.pigment);

        if (p.random() < 0.024 * this.wetness) {
          this.pool.spawnAgent(this.x, this.y, 0.6);
        }

        if (p.random() < 0.01) {
          const forkAngle = dir + p.random(-1.1, 1.1);
          const forkDist = p.lerp(3, 14, scale);
          const fx = this.x + p.cos(forkAngle) * p.random(forkDist * 0.5, forkDist);
          const fy = this.y + p.sin(forkAngle) * p.random(forkDist * 0.5, forkDist);
          this.pool.spawnAgent(fx, fy, 0.45);
        }
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
          this.spawnAgent(
            x + p.random(-24, 24),
            y + p.random(-24, 24),
            0.85,
          );
        }
      }

      edgeBias(x, y) {
        const margin = p.min(x, y, p.width - x, p.height - y);
        return p.constrain(p.map(margin, 0, 120, 1, 0), 0, 1);
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
            const px = this.x + p.cos(angle) * dist;
            const py = this.y + p.sin(angle) * dist;
            this.spawnAgent(px, py, p.random(0.5, 1));
          }
        }

        if (this.age % 5 === 0) {
          const dabSize = p.lerp(10, 50, scale) * this.urgency;
          depositOrganicStroke(
            g,
            this.x + p.random(-16, 16),
            this.y + p.random(-16, 16),
            dabSize,
            p.random(2.5, 6),
            this.edgeBias(this.x, this.y),
            this.pigment,
          );
        }

        this.agents = this.agents.filter((agent) => agent.alive());
        for (const agent of this.agents) {
          agent.step(g, scale);
        }
      }
    }

    function randomSoakPoint(favorEdges = false) {
      if (!favorEdges || p.random() > 0.2) {
        return {
          x: p.random(p.width),
          y: p.random(p.height),
          driftAngle: p.random(-0.5, 0.5),
          urgency: p.random(0.95, 1.35),
        };
      }

      const edge = p.floor(p.random(4));
      const pad = p.random(0, 90);
      switch (edge) {
        case 0:
          return { x: p.random(p.width), y: pad, driftAngle: p.random(0.2, 1.2), urgency: 1.5 };
        case 1:
          return { x: p.width - pad, y: p.random(p.height), driftAngle: p.random(1.8, 3.2), urgency: 1.5 };
        case 2:
          return { x: p.random(p.width), y: p.height - pad, driftAngle: p.random(-1.2, -0.2), urgency: 1.5 };
        default:
          return { x: pad, y: p.random(p.height), driftAngle: p.random(-3.2, -1.8), urgency: 1.5 };
      }
    }

    function randomPointNearCenter() {
      const angle = p.random(p.TWO_PI);
      const dist = p.pow(p.random(), 0.6) * screenDiagonal() * colorProgress() * 0.45;
      return {
        x: p.width * 0.5 + p.cos(angle) * dist,
        y: p.height * 0.5 + p.sin(angle) * dist,
      };
    }

    function spawnPools(count, favorEdges = false) {
      for (let i = 0; i < count; i += 1) {
        if (pools.length >= MAX_POOLS) {
          pools.shift();
        }
        const useCenter = p.random() < p.lerp(0.55, 0.15, colorProgress());
        const point = useCenter ? randomPointNearCenter() : randomSoakPoint(favorEdges);
        pools.push(new PaintPool(point.x, point.y, {
          ...point,
          driftAngle: point.driftAngle ?? p.random(-0.5, 0.5),
          urgency: point.urgency ?? p.random(0.95, 1.35),
        }));
      }
    }

    function applySubmergeTide(g, strength) {
      if (strength < 0.35) {
        return;
      }

      tideOffset += 0.006;
      const eased = p.pow((strength - 0.35) / 0.65, 0.9);
      const bands = p.floor(p.map(eased, 0, 1, 3, 9));

      for (let b = 0; b < bands; b += 1) {
        const yBase = p.map(b, 0, bands, p.height * 1.05, p.height * 0.12);
        const pigment = pigmentFor(p.width * 0.5, yBase, tideOffset + b);
        const steps = p.ceil(p.width / 28);

        for (let i = 0; i <= steps; i += 1) {
          const x = (p.width / steps) * i;
          const wave =
            p.noise(x * 0.004, tideOffset + b * 0.7, tideOffset) * 55 +
            p.noise(x * 0.012, tideOffset * 2, b) * 22;
          const y = yBase + wave + p.random(-6, 6);
          depositOrganicStroke(g, x, y, p.random(30, 80), p.random(1, 2.8) * eased, 0, pigment);
        }
      }
    }

    function applyAmbientMist(g, strength) {
      const mistCount = p.floor(p.map(strength, 0, 1, 3, 12));
      for (let i = 0; i < mistCount; i += 1) {
        const x = p.random(p.width);
        const y = p.random(p.height);
        const pigment = pigmentFor(x, y, tideOffset + i);
        const size = p.lerp(35, 150, strength);
        depositOrganicStroke(g, x, y, size, p.random(1, 3.2) * strength, 0, pigment);
      }
    }

    function sealBreakLayer() {
      for (let i = 0; i < 12; i += 1) {
        const point = randomSoakPoint(true);
        const pool = new PaintPool(point.x, point.y, { ...point, urgency: 1.4 });
        pool.life = 70;
        pools.push(pool);
      }
      applyAmbientMist(wash, 0.55);
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
        coverage = p.min(1, elapsed / PAINT_IN_MS);
        const soakStrength = p.pow(coverage, 0.72);

        if (p.frameCount % p.floor(p.map(coverage, 0, 1, 5, 12)) === 0) {
          const batch = coverage < 0.75 ? p.floor(p.random(2, 4)) : p.floor(p.random(1, 2));
          spawnPools(batch, coverage > 0.3);
        }

        applySubmergeTide(wash, soakStrength);
        if (p.frameCount % 3 === 0) {
          applyAmbientMist(wash, soakStrength * 0.5);
        }

        if (elapsed >= PAINT_IN_MS) {
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

      pools = pools.filter((pool) => pool.alive());
      const soakStrength = mode === 'paintIn' ? p.pow(coverage, 0.72) : 0.4;
      for (const pool of pools) {
        pool.update(wash, soakStrength);
      }

      drawComposite();
    };

    p.windowResized = () => {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      const snapshot = wash.get();
      resetWash();
      wash.image(snapshot, 0, 0);
    };

    api.startPaintIn = async (options = {}) => {
      const w = p.windowWidth || window.innerWidth || screen.width;
      const h = p.windowHeight || window.innerHeight || screen.height;
      p.resizeCanvas(w, h);
      breakNumber = options.breakNumber ?? 1;
      maxBreaks = options.maxBreaks ?? 10;
      mode = 'paintIn';
      paintInStart = p.millis();
      paintOutStart = 0;
      coverage = 0;
      finishedPaintIn = false;
      finishedPaintOut = false;
      tideOffset = p.random(100);
      pools = [];
      resetWash();

      if (options.previousCanvas) {
        await loadPreviousCanvas(options.previousCanvas);
      }

      spawnPools(p.floor(p.map(breakNumber, 1, maxBreaks, 5, 8)), true);
      p.loop();
    };

    api.startPaintOut = () => {
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
