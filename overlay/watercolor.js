export const WHITE_PIGMENT = { r: 255, g: 252, b: 247 };

export function createWatercolorTools(p) {
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

  function depositOrganicMark(g, mark) {
    const { x, y, w, h, rotation, pigment } = mark;
    const alpha = p.random(5, 11);
    const baseSize = Math.max(w, h);

    g.push();
    g.translate(x, y);
    g.rotate(rotation + p.random(-0.25, 0.25));
    g.scale(w / baseSize, h / baseSize);

    depositDab(g, 0, 0, baseSize * 0.4, pigment, alpha);
    depositDab(
      g,
      p.random(-3, 3),
      p.random(-3, 3),
      baseSize * p.random(0.2, 0.36),
      pigment,
      alpha * p.random(0.35, 0.65),
    );
    g.pop();
  }

  function createBleedAgent(x, y, pool) {
    return {
      x,
      y,
      pool,
      z: p.random(1000),
      speed: p.random(0.6, 2.2),
      wetness: p.random(0.55, 1),
      radius: p.random(4, 14),
      life: p.floor(p.random(90, 200)),
      age: 0,
      alive() {
        return this.age < this.life;
      },
      step(g, scale) {
        this.age += 1;
        const flowAngle =
          p.noise(this.x * 0.0028, this.y * 0.0028, this.z) * p.TWO_PI * 2.2 +
          this.pool.driftAngle;
        const meander = p.map(
          p.noise(this.x * 0.008, this.y * 0.008, this.z * 1.7),
          0,
          1,
          -1.1,
          1.1,
        );
        const dir = flowAngle + meander;
        const pace = this.speed * this.wetness * scale;
        this.x += p.cos(dir) * pace + p.random(-0.8, 0.8);
        this.y += p.sin(dir) * pace + p.random(-0.8, 0.8);
        this.z += p.random(0.004, 0.012);

        const fade = 1 - this.age / this.life;
        const alpha = p.random(3, 7.5) * fade * this.wetness;
        const size = this.radius * p.lerp(0.5, 1, this.age / this.life) * scale;
        depositDab(g, this.x, this.y, size, this.pool.pigment, alpha);
      },
    };
  }

  function createMarkBleedPool(mark, options = {}) {
    const pool = {
      x: mark.x,
      y: mark.y,
      pigment: mark.pigment,
      driftAngle: mark.rotation + p.random(-0.35, 0.35),
      agents: [],
      age: 0,
      life: options.life ?? p.floor(p.random(70, 130)),
      spawnRate: options.spawnRate ?? p.random(0.35, 0.6),
      maxAgents: options.maxAgents ?? 8,
      spawnAgent(x, y, wetnessScale = 1) {
        if (this.agents.length >= this.maxAgents) {
          return;
        }
        const agent = createBleedAgent(x, y, this);
        agent.wetness *= wetnessScale;
        agent.radius *= 0.85 + wetnessScale * 0.15;
        this.agents.push(agent);
      },
      alive() {
        return this.age < this.life || this.agents.some((agent) => agent.alive());
      },
      update(g, scale) {
        this.age += 1;
        if (this.age < this.life && p.random() < this.spawnRate * scale) {
          const spread = p.lerp(6, 28, p.pow(this.age / this.life, 0.65));
          for (let i = 0; i < p.floor(p.random(1, 3)); i += 1) {
            const angle = p.random(p.TWO_PI);
            const dist = p.random(0, spread);
            this.spawnAgent(
              this.x + p.cos(angle) * dist,
              this.y + p.sin(angle) * dist,
              p.random(0.45, 0.9),
            );
          }
        }

        this.agents = this.agents.filter((agent) => agent.alive());
        for (const agent of this.agents) {
          agent.step(g, scale);
        }
      },
    };

    const initial = p.floor(p.random(2, 5));
    for (let i = 0; i < initial; i += 1) {
      pool.spawnAgent(
        mark.x + p.random(-10, 10),
        mark.y + p.random(-10, 10),
        0.9,
      );
    }

    return pool;
  }

  function applyPaperTexture(g, strength, bounds = null) {
    const count = p.floor(p.map(strength, 0, 1, 2, 7));
    for (let i = 0; i < count; i += 1) {
      const x = bounds
        ? p.random(bounds.left, bounds.right)
        : p.random(g.width);
      const y = bounds
        ? p.random(bounds.top, bounds.bottom)
        : p.random(g.height);
      depositDab(g, x, y, p.random(16, 48), WHITE_PIGMENT, p.random(0.35, 1) * strength);
    }
  }

  function applyUnrevealedMist(g, layout, revealFraction, strength) {
    if (!layout || strength <= 0) {
      return;
    }

    const cx = layout.offsetX + layout.drawW * 0.5;
    const cy = layout.offsetY + layout.drawH * 0.5;
    const maxR = p.min(layout.drawW, layout.drawH) * 0.58;
    const revealR = maxR * p.constrain(revealFraction, 0.05, 1);
    const count = p.floor(p.map(strength, 0, 1, 2, 5));

    for (let i = 0; i < count; i += 1) {
      const x = p.random(layout.offsetX, layout.offsetX + layout.drawW);
      const y = p.random(layout.offsetY, layout.offsetY + layout.drawH);
      if (p.dist(x, y, cx, cy) > revealR + p.random(-20, 30)) {
        depositDab(
          g,
          x,
          y,
          p.random(14, 38),
          WHITE_PIGMENT,
          p.random(0.3, 0.9) * strength,
        );
      }
    }
  }

  return {
    depositDab,
    depositOrganicMark,
    createMarkBleedPool,
    applyPaperTexture,
    applyUnrevealedMist,
  };
}
