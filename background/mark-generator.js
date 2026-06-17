export const MARKS_VERSION = 8;
export const GRID_SIZE = 7;
export const MAX_SAMPLE_WIDTH = 900;

function rgbToHsb(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
        break;
    }
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function markHash(nx1k, ny1k, salt) {
  const s = Math.sin(nx1k * 127.1 + ny1k * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function distFromCenter(nx, ny) {
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  return Math.sqrt(dx * dx + dy * dy);
}

function centerWobble(nx, ny) {
  return (markHash(Math.round(nx * 1000), Math.round(ny * 1000), 99) - 0.5) * 0.06;
}

export async function fetchImageData(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch artwork image (${response.status})`);
  }

  const blob = await response.blob();
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  const scale = Math.min(1, MAX_SAMPLE_WIDTH / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return {
    imageData: ctx.getImageData(0, 0, width, height),
    width,
    height,
  };
}

function sampleCellColor(imageData, width, height, cellX, cellY) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let aSum = 0;
  let count = 0;

  for (let dy = 0; dy < GRID_SIZE; dy += 1) {
    for (let dx = 0; dx < GRID_SIZE; dx += 1) {
      const px = Math.min(width - 1, cellX + dx);
      const py = Math.min(height - 1, cellY + dy);
      const i = (py * width + px) * 4;
      const a = imageData[i + 3];
      if (a < 40) {
        continue;
      }
      rSum += imageData[i];
      gSum += imageData[i + 1];
      bSum += imageData[i + 2];
      aSum += a;
      count += 1;
    }
  }

  if (count === 0 || aSum / count < 40) {
    return null;
  }

  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
}

export function generateMarksFromImageData(imageData, width, height, maxBreaks = 10) {
  const rawMarks = [];

  for (let y = 0; y < height; y += GRID_SIZE) {
    for (let x = 0; x < width; x += GRID_SIZE) {
      const color = sampleCellColor(imageData, width, height, x, y);
      if (!color) {
        continue;
      }

      const { r, g, b } = color;
      const nx = (x + GRID_SIZE / 2) / width;
      const ny = (y + GRID_SIZE / 2) / height;
      const hsb = rgbToHsb(r, g, b);
      const brightnessScaler = hsb.v;
      const saturationScaler = Math.max(hsb.s, 0.12);
      const rot = hsb.h;
      const mw = Math.min(1.4, brightnessScaler * 2);
      const mh = Math.min(1.6, (1 / saturationScaler) * 0.55);

      rawMarks.push({
        nx,
        ny,
        r,
        g,
        b,
        rot,
        mw,
        mh,
        sortKey: distFromCenter(nx, ny) + centerWobble(nx, ny),
      });
    }
  }

  rawMarks.sort((a, b) => a.sortKey - b.sortKey);

  const marksPerBreak = Math.max(1, Math.ceil(rawMarks.length / maxBreaks));
  const marks = rawMarks.map((mark, index) => [
    Math.round(mark.nx * 1000),
    Math.round(mark.ny * 1000),
    mark.r,
    mark.g,
    mark.b,
    Math.round(mark.rot * 255),
    Math.round(mark.mw * 100),
    Math.round(mark.mh * 100),
    Math.min(maxBreaks, Math.floor(index / marksPerBreak) + 1),
  ]);

  return {
    version: MARKS_VERSION,
    objectID: null,
    sampleWidth: width,
    sampleHeight: height,
    gridSize: GRID_SIZE,
    count: marks.length,
    marks,
  };
}

export async function generateMarksFromImageUrl(imageUrl, objectID, maxBreaks = 10) {
  const { imageData, width, height } = await fetchImageData(imageUrl);
  const marks = generateMarksFromImageData(imageData.data, width, height, maxBreaks);
  marks.objectID = objectID;
  return marks;
}

export function expandMark(compact, layout) {
  const [nx1k, ny1k, r, g, b, rot255, mw100, mh100, breakIndex] = compact;
  const cellSize = layout.gridSize * layout.scale;
  const brightnessScale = mw100 / 100;
  const saturationScale = mh100 / 100;
  const shapeScale = Math.max(brightnessScale, saturationScale, 0.85);

  const h1 = markHash(nx1k, ny1k, 1);
  const h2 = markHash(nx1k, ny1k, 2);
  const h6 = markHash(nx1k, ny1k, 6);

  const baseX = layout.offsetX + (nx1k / 1000) * layout.drawW;
  const baseY = layout.offsetY + (ny1k / 1000) * layout.drawH;
  const size = cellSize * Math.max(2.0, shapeScale * 2.75);

  return {
    x: baseX + (h1 - 0.5) * cellSize * 0.16,
    y: baseY + (h2 - 0.5) * cellSize * 0.16,
    pigment: { r, g, b },
    rotation: (rot255 / 255) * Math.PI * 2 + (h6 - 0.5) * 0.5,
    cellSize,
    w: size,
    h: size * lerpHash(h1, 0.82, 1.18),
    breakIndex,
  };
}

function lerpHash(hash, lo, hi) {
  return lo + hash * (hi - lo);
}

export function computeImageLayout(sampleWidth, sampleHeight, screenWidth, screenHeight) {
  const scale = Math.min(screenWidth / sampleWidth, screenHeight / sampleHeight);
  const drawW = sampleWidth * scale;
  const drawH = sampleHeight * scale;

  return {
    scale,
    drawW,
    drawH,
    offsetX: (screenWidth - drawW) / 2,
    offsetY: (screenHeight - drawH) / 2,
    gridSize: GRID_SIZE,
    sampleWidth,
    sampleHeight,
  };
}

export function getMarksForBreak(marksData, breakNumber) {
  if (!marksData?.marks) {
    return [];
  }
  return marksData.marks.filter((mark) => mark[8] === breakNumber);
}

export function packMarksForBreak(marksData, breakNumber) {
  if (!marksData?.marks) {
    return null;
  }

  return {
    version: marksData.version,
    objectID: marksData.objectID,
    sampleWidth: marksData.sampleWidth,
    sampleHeight: marksData.sampleHeight,
    gridSize: marksData.gridSize,
    breakNumber,
    marks: getMarksForBreak(marksData, breakNumber),
  };
}
