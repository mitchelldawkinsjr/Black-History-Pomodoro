/**
 * Natural watercolor wash — inspired by the original liquid/drop sketch,
 * using noise-shaped splotches and capillary tendrils instead of concentric ellipses.
 */

const PAINT_IN_MS = 25000;
const PAINT_OUT_MS = 25000;
const MAX_BLOOMS = 140;

export function createPaintSketch(container, { onPaintInComplete, onPaintOutComplete, onReady } = {}) {
  const api = {};

  const instance = new p5((p) => {
    let wash;
    let blooms = [];
    let mode = 'idle';
    let paintInStart = 0;
    let paintOutStart = 0;
    let coverage = 0;
    let finishedPaintIn = false;
    let finishedPaintOut = false;

    function resetWash() {
      wash = p.createGraphics(p.width, p.height);
      wash.noStroke();
      wash.background(255, 255, 255, 0);
    }

    function pigmentFor(x, y) {
      return {
        r: p.constrain(x / p.width * 170 + 45, 45, 215),
        g: p.constrain(65 + p.noise(x * 0.004, y * 0.004) * 130, 45, 195),
        b: p.constrain(y / p.height * 150 + 35, 35, 205),
      };
    }

    class Bloom {
      constructor(x, y, urgency = 1) {
        this.x = x;
        this.y = y;
        this.age = 0;
        this.urgency = urgency;
        this.life = p.random(140, 260);
        this.maxSpread = p.random(p.width * 0.18, p.width * 0.48) * urgency;
        this.noiseOff = p.random(10000);
        const pigment = pigmentFor(x, y);
        this.r = pigment.r;
        this.g = pigment.g;
        this.b = pigment.b;
      }

      alive() {
        return this.age < this.life;
      }

      update(g) {
        this.age += 1;
        const t = this.age / this.life;
        const spread = p.pow(t, 0.55) * this.maxSpread;

        this.depositPool(g, this.x, this.y, spread * 0.07, 1.2);
        this.spreadWash(g, spread);

        if (this.age % 2 === 0) {
          for (let i = 0; i < 3; i += 1) {
            this.tendril(g, spread);
          }
        }
      }

      spreadWash(g, spread) {
        const petals = 10;
        for (let i = 0; i < petals; i += 1) {
          const angle =
            (p.TWO_PI / petals) * i +
            p.noise(this.noiseOff + i * 0.3) * 1.2;
          const wobble =
            p.noise(this.noiseOff + this.age * 0.018 + i * 0.5) * 0.55 + 0.45;
          const dist = spread * wobble * p.random(0.65, 1.15);
          const px = this.x + p.cos(angle) * dist;
          const py = this.y + p.sin(angle) * dist;
          this.organicSplotch(g, px, py, spread * 0.11 * wobble, wobble);
        }
      }

      organicSplotch(g, x, y, size, intensity = 1) {
        const layers = 4;
        for (let layer = 0; layer < layers; layer += 1) {
          const layerSize = size * (1 - layer / layers) * p.random(0.85, 1.15);
          const alpha = p.random(3, 8) * intensity * (1 - layer / (layers + 1));
          g.fill(this.r, this.g, this.b, alpha);

          g.beginShape();
          const verts = p.floor(p.random(9, 16));
          for (let v = 0; v < verts; v += 1) {
            const ang = (p.TWO_PI / verts) * v;
            const n = p.noise(
              x * 0.007 + p.cos(ang),
              y * 0.007 + p.sin(ang),
              this.noiseOff + layer * 0.2 + v * 0.08,
            );
            const rad = layerSize * (0.35 + n * 0.95);
            g.vertex(x + p.cos(ang) * rad, y + p.sin(ang) * rad * p.random(0.75, 1.25));
          }
          g.endShape(p.CLOSE);
        }
      }

      depositPool(g, x, y, size, intensity) {
        for (let i = 0; i < 6; i += 1) {
          const px = x + p.random(-size * 0.4, size * 0.4);
          const py = y + p.random(-size * 0.4, size * 0.4);
          this.organicSplotch(g, px, py, size * p.random(0.6, 1.1), intensity);
        }
      }

      tendril(g, spread) {
        let tx = this.x;
        let ty = this.y;
        let angle = p.random(p.TWO_PI);
        const steps = p.floor(p.random(10, 24));
        const stepLen = spread * 0.012;

        for (let s = 0; s < steps; s += 1) {
          angle += p.random(-0.55, 0.55);
          tx += p.cos(angle) * stepLen;
          ty += p.sin(angle) * stepLen;

          const alpha = p.random(0.8, 3.5);
          g.fill(this.r, this.g, this.b, alpha);
          const w = p.random(1.5, 5);
          const h = w * p.random(0.5, 1.8);
          g.ellipse(tx, ty, w, h);
        }
      }
    }

    function randomPoint(favorEdges = false) {
      if (!favorEdges || p.random() > 0.35) {
        return { x: p.random(p.width), y: p.random(p.height) };
      }

      const edge = p.floor(p.random(4));
      const pad = p.random(40, 120);
      switch (edge) {
        case 0:
          return { x: p.random(p.width), y: pad };
        case 1:
          return { x: p.width - pad, y: p.random(p.height) };
        case 2:
          return { x: p.random(p.width), y: p.height - pad };
        default:
          return { x: pad, y: p.random(p.height) };
      }
    }

    function spawnBlooms(count, favorEdges = false) {
      for (let i = 0; i < count; i += 1) {
        if (blooms.length >= MAX_BLOOMS) {
          blooms.shift();
        }
        const { x, y } = randomPoint(favorEdges);
        const urgency = favorEdges ? 1.35 : 1;
        blooms.push(new Bloom(x, y, urgency));
      }
    }

    function sealFullCoverage() {
      for (let i = 0; i < 24; i += 1) {
        const { x, y } = randomPoint(true);
        const bloom = new Bloom(x, y, 1.6);
        bloom.life = 80;
        blooms.push(bloom);
      }
      wash.fill(248, 242, 234, 55);
      wash.rect(0, 0, p.width, p.height);
    }

    function finishPaintIn() {
      if (finishedPaintIn) {
        return;
      }
      finishedPaintIn = true;
      sealFullCoverage();
      mode = 'resting';
      onPaintInComplete?.();
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

      if (mode === 'paintIn') {
        const elapsed = p.millis() - paintInStart;
        coverage = p.min(1, elapsed / PAINT_IN_MS);

        if (p.frameCount % p.floor(p.map(coverage, 0, 1, 6, 14)) === 0) {
          const batch = coverage < 0.75 ? p.floor(p.random(2, 5)) : p.floor(p.random(1, 3));
          spawnBlooms(batch, coverage > 0.4);
        }

        if (elapsed >= PAINT_IN_MS) {
          finishPaintIn();
        }
      }

      if (mode === 'paintOut') {
        const elapsed = p.millis() - paintOutStart;
        const progress = p.min(1, elapsed / PAINT_OUT_MS);

        for (let i = 0; i < 8; i += 1) {
          const lx = p.random(p.width);
          const ly = p.random(p.height);
          const lift = progress * p.max(p.width, p.height) * p.random(0.15, 0.45);
          for (let r = lift; r > 0; r -= lift / 5) {
            wash.fill(255, 252, 248, p.random(6, 16));
            wash.beginShape();
            const verts = 10;
            for (let v = 0; v < verts; v += 1) {
              const ang = (p.TWO_PI / verts) * v;
              const wobble = p.noise(lx * 0.01, ly * 0.01, v + progress * 5) * 0.35;
              const rad = r * (0.7 + wobble);
              wash.vertex(lx + p.cos(ang) * rad, ly + p.sin(ang) * rad);
            }
            wash.endShape(p.CLOSE);
          }
        }

        wash.fill(255, 255, 255, progress * 10 + 0.5);
        wash.rect(0, 0, p.width, p.height);

        if (progress >= 1) {
          finishPaintOut();
        }
      }

      blooms = blooms.filter((bloom) => bloom.alive());
      for (const bloom of blooms) {
        bloom.update(wash);
      }

      p.clear();
      p.image(wash, 0, 0);

      if (mode === 'paintIn') {
        p.fill(252, 247, 240, coverage * 35);
        p.rect(0, 0, p.width, p.height);
      }
    };

    p.windowResized = () => {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      const snapshot = wash.get();
      resetWash();
      wash.image(snapshot, 0, 0);
    };

    api.startPaintIn = () => {
      const w = p.windowWidth || window.innerWidth || screen.width;
      const h = p.windowHeight || window.innerHeight || screen.height;
      p.resizeCanvas(w, h);
      mode = 'paintIn';
      paintInStart = p.millis();
      paintOutStart = 0;
      coverage = 0;
      finishedPaintIn = false;
      finishedPaintOut = false;
      blooms = [];
      resetWash();
      spawnBlooms(8);
      p.loop();
    };

    api.startPaintOut = () => {
      mode = 'paintOut';
      paintOutStart = p.millis();
      finishedPaintOut = false;
      blooms = [];
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
      blooms = [];
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
