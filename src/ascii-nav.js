const NAV_RAMP = ' .:-=+*oO#%@';
const UI_SCALE = 8;

export const ASCII_NAV_HI = 2;

function charFromRamp(brightness) {
  const index = Math.min(
    NAV_RAMP.length - 1,
    Math.floor((1 - brightness) * NAV_RAMP.length),
  );
  return NAV_RAMP[index];
}

function readNavItems() {
  return [...document.querySelectorAll('#site-nav a')].map((link) => ({
    label: link.textContent.replace(/\s+/g, ' ').trim().toUpperCase(),
    href: link.getAttribute('href') || '/',
    current: link.getAttribute('aria-current') === 'page',
  }));
}

function dilate(source, cols, rows, radius = 1) {
  const output = new Float32Array(source.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          max = Math.max(max, source[ny * cols + nx]);
        }
      }
      output[y * cols + x] = max;
    }
  }
  return output;
}

export function buildAsciiNav(cols, rows) {
  const letter = new Float32Array(cols * rows);

  const hiCols = cols * ASCII_NAV_HI;
  const hiRows = rows * ASCII_NAV_HI;
  const letterHi = new Float32Array(hiCols * hiRows);
  const hiCell = UI_SCALE / ASCII_NAV_HI;
  const regions = [];
  const width = cols * UI_SCALE;
  const height = rows * UI_SCALE;
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const context = offscreen.getContext('2d', { willReadFrequently: true });
  context.textBaseline = 'top';
  context.textAlign = 'left';

  const compact = window.innerWidth <= 600;
  const navX = compact ? Math.max(3, Math.round(cols * 0.1)) : Math.round(cols * 0.18);
  const fontSize = compact ? 3.35 : 4.5;
  const rowStep = compact ? 4.8 : 5.4;
  let cursorY = 5;

  readNavItems().forEach((item, id) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.font = `${fontSize * UI_SCALE}px "Share Tech Mono", "Courier New", monospace`;
    context.letterSpacing = `${fontSize * UI_SCALE * 0.22}px`;
    context.fillText(item.label, navX * UI_SCALE, cursorY * UI_SCALE);
    const { data } = context.getImageData(0, 0, width, height);

    for (let hy = 0; hy < hiRows; hy += 1) {
      for (let hx = 0; hx < hiCols; hx += 1) {
        let sum = 0;
        const x0 = hx * hiCell;
        const y0 = hy * hiCell;
        for (let sy = 0; sy < hiCell; sy += 1) {
          for (let sx = 0; sx < hiCell; sx += 1) {
            sum += data[((y0 + sy) * width + (x0 + sx)) * 4] / 255;
          }
        }
        const alpha = sum / (hiCell * hiCell);
        if (alpha >= 0.14) {
          letterHi[hy * hiCols + hx] = Math.max(letterHi[hy * hiCols + hx], alpha);
        }
      }
    }

    let minX = cols;
    let minY = rows;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let sum = 0;
        const x0 = x * UI_SCALE;
        const y0 = y * UI_SCALE;
        for (let sy = 0; sy < UI_SCALE; sy += 1) {
          for (let sx = 0; sx < UI_SCALE; sx += 1) {
            sum += data[((y0 + sy) * width + (x0 + sx)) * 4] / 255;
          }
        }
        const alpha = sum / (UI_SCALE * UI_SCALE);
        if (alpha < 0.18) continue;
        found = true;
        const index = y * cols + x;
        letter[index] = Math.max(letter[index], alpha);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (found) {
      regions.push({
        ...item,
        id,
        minX: Math.max(0, minX - 1),
        minY: Math.max(0, minY - 1),
        maxX: Math.min(cols - 1, maxX + 1),
        maxY: Math.min(rows - 1, maxY + 1),
      });
    }
    cursorY += rowStep;
  });

  return {
    letter,
    halo: dilate(letter, cols, rows, 1),
    regions,
    letterHi,
    hiCols,
    hiRows,
  };
}

export function buildNavHitBoxes(regions, cellW, cellH, motion, reducedMotion) {
  const { t, scanNorm, driftX, driftY } = motion;
  const scanY = scanNorm * (window.innerHeight / cellH);
  return regions.map((region) => {
    const midX = (region.minX + region.maxX) / 2;
    const midY = (region.minY + region.maxY) / 2;
    const band = Math.max(0, 1 - Math.abs(midY - scanY) / 5);
    const ox = reducedMotion ? 0 : driftX * (0.15 + band * 0.35);
    const oy = reducedMotion
      ? 0
      : driftY * (0.1 + band * 0.25)
        + Math.sin(midX * 0.22 + midY * 0.17 + t * 1.6) * cellH * 0.3;
    return {
      ...region,
      x: region.minX * cellW + ox - 4,
      y: region.minY * cellH + oy - 3,
      w: (region.maxX - region.minX + 1) * cellW + 8,
      h: (region.maxY - region.minY + 1) * cellH + 6,
    };
  });
}

export function hitTestAsciiNav(hitBoxes, x, y) {
  for (let index = hitBoxes.length - 1; index >= 0; index -= 1) {
    const box = hitBoxes[index];
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      return box;
    }
  }
  return null;
}

export function drawAsciiNav(context, nav, options) {
  const {
    cellW,
    cellH,
    motion,
    reducedMotion,
    hoveredId,
    foreground,
    accent,
    rippleField = () => ({ b: 0, ox: 0, oy: 0 }),
  } = options;
  const { t, scanNorm, driftX, driftY } = motion;
  const scanY = scanNorm * (window.innerHeight / cellH);
  const hiCellW = cellW / ASCII_NAV_HI;
  const hiCellH = cellH / ASCII_NAV_HI;
  const navFont = Math.max(2.5, hiCellH * 1.05);

  context.font = `${navFont}px "Share Tech Mono", "Courier New", monospace`;
  context.textBaseline = 'top';

  nav.regions.forEach((region) => {
    const isHovered = region.id === hoveredId;
    context.fillStyle = region.current ? accent : foreground;
    for (let hy = region.minY * ASCII_NAV_HI; hy < (region.maxY + 1) * ASCII_NAV_HI; hy += 1) {
      for (let hx = region.minX * ASCII_NAV_HI; hx < (region.maxX + 1) * ASCII_NAV_HI; hx += 1) {
        const alpha = nav.letterHi[hy * nav.hiCols + hx];
        if (alpha <= 0.16) continue;
        const gx = hx / ASCII_NAV_HI;
        const gy = hy / ASCII_NAV_HI;
        const px = hx * hiCellW;
        const py = hy * hiCellH;
        const wave = reducedMotion ? 0 : Math.sin(gx * 0.5 + gy * 0.4 + t * 1.6);
        const band = Math.max(0, 1 - Math.abs(gy - scanY) / 6);
        const ripple = rippleField(px, py);
        const brightness = isHovered
          ? (alpha > 0.32 ? 0.03 : Math.min(1, 1 - alpha))
          : Math.min(1, Math.max(0, (1 - alpha) * 0.82 - band * 0.1 - wave * 0.025 + ripple.b * 0.12));
        const ox = isHovered ? 0 : (reducedMotion ? 0 : driftX * 0.18 + wave * 0.18) + ripple.ox * hiCellW;
        const oy = isHovered ? 0 : (reducedMotion ? 0 : driftY * 0.15) + ripple.oy * hiCellH;
        context.globalAlpha = isHovered ? 1 : 0.88 + band * 0.12;
        context.fillText(charFromRamp(brightness), px + ox, py + oy);
      }
    }
  });

  context.font = '11px "Share Tech Mono", "Courier New", monospace';
  nav.regions.forEach((region) => {
    if (!region.current) return;
    const midY = (region.minY + region.maxY) / 2;
    const band = Math.max(0, 1 - Math.abs(midY - scanY) / 5);
    const ox = reducedMotion ? 0 : driftX * (0.15 + band * 0.35);
    const oy = reducedMotion
      ? 0
      : driftY * (0.1 + band * 0.25)
        + Math.sin(region.minX * 0.22 + midY * 0.17 + t * 1.6) * cellH * 0.3;
    context.globalAlpha = 0.95;
    context.fillStyle = accent;
    for (let y = region.minY; y <= region.maxY; y += 1) {
      context.fillText('#', (region.minX - 1) * cellW + ox, y * cellH + oy);
    }
  });
  context.globalAlpha = 1;
}
