/**
 * Color-matching pen agents — wander toward similar hues in the source image
 * and deposit watercolor dabs along curved paths (adapted from p5 agent sketch).
 */

export function createColorAgents(p, wc) {
  let sampleWidth = 0;
  let sampleHeight = 0;
  let pixels = null;
  let matrix = null;
  let breakMask = null;
  let layout = null;
  let pens = [];
  let agentRange = 12;

  function idx(x, y) {
    return y * sampleWidth + x;
  }

  function getColor(x, y) {
    const off = idx(x, y) * 4;
    return [pixels[off], pixels[off + 1], pixels[off + 2], pixels[off + 3]];
  }

  function sampleToScreen(sx, sy) {
    return {
      x: layout.offsetX + (sx / sampleWidth) * layout.drawW,
      y: layout.offsetY + (sy / sampleHeight) * layout.drawH,
    };
  }

  function colorDistance(pigment, rgb) {
    return (
      (pigment.r - rgb[0]) ** 2 +
      (pigment.g - rgb[1]) ** 2 +
      (pigment.b - rgb[2]) ** 2
    );
  }

  function buildBreakMask(marksData) {
    breakMask = new Uint8Array(sampleWidth * sampleHeight);
    const grid = marksData.gridSize || 7;

    for (const compact of marksData.marks) {
      const [nx1k, ny1k, , , , , , , breakIndex] = compact;
      if (breakIndex !== marksData.breakNumber) {
        continue;
      }

      const cx = Math.floor((nx1k / 1000) * sampleWidth);
      const cy = Math.floor((ny1k / 1000) * sampleHeight);

      for (let dy = 0; dy < grid; dy += 1) {
        for (let dx = 0; dx < grid; dx += 1) {
          const x = Math.min(sampleWidth - 1, cx + dx);
          const y = Math.min(sampleHeight - 1, cy + dy);
          breakMask[idx(x, y)] = 1;
        }
      }
    }
  }

  function randomMaskedPixel(maxAttempts = 80) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const x = p.floor(p.random(sampleWidth * 0.2, sampleWidth * 0.8));
      const y = p.floor(p.random(sampleHeight * 0.2, sampleHeight * 0.8));
      if (breakMask[idx(x, y)] && matrix[idx(x, y)] === 0) {
        return { x, y };
      }
    }

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        if (breakMask[idx(x, y)] && matrix[idx(x, y)] === 0) {
          return { x, y };
        }
      }
    }

    return {
      x: p.floor(sampleWidth * 0.5),
      y: p.floor(sampleHeight * 0.5),
    };
  }

  function createPen(initX, initY, options) {
    const startColor = getColor(initX, initY);
    const brushRadius = options.brushRadius ?? 3.5;
    const brushAlpha = options.brushAlpha ?? 7;

    return {
      origx: initX,
      origy: initY,
      prevx: initX,
      prevy: initY,
      destx: initX,
      desty: initY,
      stuckCount: 0,
      pigment: { r: startColor[0], g: startColor[1], b: startColor[2] },

      findDestinationPoint() {
        let closestDistance = Number.MAX_SAFE_INTEGER;
        const candidates = [];
        this.destx = this.origx;
        this.desty = this.origy;

        const yMin = p.max(this.origy - agentRange, 0);
        const yMax = p.min(this.origy + agentRange, sampleHeight - 1);
        const xMin = p.max(this.origx - agentRange, 0);
        const xMax = p.min(this.origx + agentRange, sampleWidth - 1);

        for (let y = yMin; y <= yMax; y += 1) {
          for (let x = xMin; x <= xMax; x += 1) {
            const id = idx(x, y);
            if (matrix[id] !== 0 || breakMask[id] === 0) {
              continue;
            }

            const dist = colorDistance(this.pigment, getColor(x, y));
            if (dist === 0) {
              continue;
            }

            if (dist < closestDistance) {
              candidates.length = 0;
              candidates.push({ x, y });
              closestDistance = dist;
            } else if (dist === closestDistance) {
              candidates.push({ x, y });
            }
          }
        }

        if (candidates.length === 0) {
          this.stuckCount += 1;
          if (this.stuckCount > 6) {
            const respawn = randomMaskedPixel();
            this.origx = respawn.x;
            this.origy = respawn.y;
            this.prevx = respawn.x;
            this.prevy = respawn.y;
            this.destx = respawn.x;
            this.desty = respawn.y;
            const nextColor = getColor(respawn.x, respawn.y);
            this.pigment = { r: nextColor[0], g: nextColor[1], b: nextColor[2] };
            matrix[idx(respawn.x, respawn.y)] = 1;
            this.stuckCount = 0;
          }
          return;
        }

        this.stuckCount = 0;
        const choice = p.random(candidates);
        this.destx = choice.x;
        this.desty = choice.y;
        matrix[idx(choice.x, choice.y)] = 1;
      },

      draw(wash, alphaScale) {
        if (this.origx === this.destx && this.origy === this.desty) {
          return;
        }

        const ctrl2x = this.destx - (this.origx - this.prevx);
        const ctrl2y = this.desty - (this.origy - this.prevy);

        const prev = sampleToScreen(this.prevx, this.prevy);
        const orig = sampleToScreen(this.origx, this.origy);
        const dest = sampleToScreen(this.destx, this.desty);
        const ctrl2 = sampleToScreen(ctrl2x, ctrl2y);

        const dabCount = 4;
        for (let i = 0; i <= dabCount; i += 1) {
          const t = i / dabCount;
          const x = p.curvePoint(prev.x, orig.x, dest.x, ctrl2.x, t);
          const y = p.curvePoint(prev.y, orig.y, dest.y, ctrl2.y, t);
          wc.depositDab(
            wash,
            x,
            y,
            brushRadius * p.random(0.75, 1.25),
            this.pigment,
            brushAlpha * alphaScale * p.random(0.8, 1.15),
          );
        }

        this.prevx = this.origx;
        this.prevy = this.origy;
        this.origx = this.destx;
        this.origy = this.desty;
      },
    };
  }

  function initFromImage(img, marksData, markLayout, options = {}) {
    sampleWidth = marksData.sampleWidth;
    sampleHeight = marksData.sampleHeight;
    layout = markLayout;
    agentRange = options.agentRange ?? 12;

    img.resize(sampleWidth, sampleHeight);
    img.loadPixels();
    pixels = img.pixels;
    matrix = new Uint8Array(sampleWidth * sampleHeight);
    buildBreakMask(marksData);

    const penQuantity = options.penQuantity ?? 24;
    pens = [];

    for (let i = 0; i < penQuantity; i += 1) {
      const spawn = randomMaskedPixel();
      matrix[idx(spawn.x, spawn.y)] = 1;
      pens.push(createPen(spawn.x, spawn.y, options));
    }
  }

  function step(wash, penSteps = 1, alphaScale = 1) {
    if (!pens.length || !wash) {
      return;
    }

    for (let s = 0; s < penSteps; s += 1) {
      for (const pen of pens) {
        pen.findDestinationPoint();
        pen.draw(wash, alphaScale);
      }
    }
  }

  function burst(wash, cycles, alphaScale = 1) {
    for (let i = 0; i < cycles; i += 1) {
      step(wash, 1, alphaScale);
    }
  }

  function reset() {
    matrix = null;
    breakMask = null;
    pixels = null;
    pens = [];
    layout = null;
  }

  function isReady() {
    return pens.length > 0 && Boolean(pixels);
  }

  return {
    initFromImage,
    step,
    burst,
    reset,
    isReady,
  };
}
