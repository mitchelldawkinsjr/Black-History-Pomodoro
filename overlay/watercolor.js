export function createWatercolorTools(p) {
  function depositDab(g, x, y, radius, pigment, alpha) {
    const layers = p.floor(p.random(3, 6));
    for (let layer = 0; layer < layers; layer += 1) {
      const t = layer / layers;
      const r = radius * (1 - t * 0.68) * p.random(0.85, 1.18);
      const a = alpha * (1 - t * 0.48) * p.random(0.72, 1.2);

      g.fill(pigment.r, pigment.g, pigment.b, a);
      g.beginShape();
      const verts = p.floor(p.random(7, 12));
      for (let v = 0; v < verts; v += 1) {
        const ang = (p.TWO_PI / verts) * v + p.random(-0.35, 0.35);
        const n = p.noise(
          x * 0.011 + p.cos(ang) * 0.35,
          y * 0.011 + p.sin(ang) * 0.35,
          layer + v * 0.06,
        );
        const wobble = 0.28 + n * 0.9;
        const rx = r * wobble * p.random(0.85, 1.22);
        const ry = r * wobble * p.random(0.7, 1.32);
        g.vertex(x + p.cos(ang) * rx, y + p.sin(ang) * ry);
      }
      g.endShape(p.CLOSE);
    }
  }

  /** Large overlapping washes — sized from mark spread, no bleed trails. */
  function depositSplotch(g, mark, richness = 1, sessionOpacity = 1) {
    const { x, y, w, h, rotation, pigment } = mark;
    const markVariance = p.random(0.55, 1.05);
    const strength = p.constrain(richness * sessionOpacity * markVariance, 0.38, 0.82);

    const spread = Math.max(w, h);

    g.push();
    g.translate(x, y);
    g.rotate(rotation + p.random(-0.2, 0.2));

    depositDab(g, 0, 0, spread * 0.52, pigment, p.random(14, 24) * strength);
    depositDab(
      g,
      p.random(-4, 4),
      p.random(-4, 4),
      spread * p.random(0.32, 0.44),
      pigment,
      p.random(18, 30) * strength * p.random(0.8, 1.15),
    );
    depositDab(
      g,
      p.random(-3, 3),
      p.random(-3, 3),
      spread * p.random(0.22, 0.34),
      pigment,
      p.random(14, 24) * strength * p.random(0.75, 1.2),
    );

    g.scale(w / spread, h / spread);
    depositDab(
      g,
      0,
      0,
      spread * p.random(0.3, 0.42),
      pigment,
      p.random(16, 26) * strength * p.random(0.85, 1.1),
    );
    depositDab(
      g,
      p.random(-4, 4),
      p.random(-4, 4),
      spread * p.random(0.18, 0.32),
      pigment,
      p.random(10, 20) * strength * p.random(0.7, 1.15),
    );

    g.pop();
  }

  return {
    depositDab,
    depositSplotch,
  };
}
