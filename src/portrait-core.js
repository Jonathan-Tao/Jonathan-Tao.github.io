// Home-page ASCII portrait renderer. It has no DOM access, so the same code
// can draw into an OffscreenCanvas in a worker or into a <canvas> on the main
// thread. ascii-portrait.js owns events, timing and layout measurements.
import { createGlyphPainter } from './ascii-glyph-painter.js';
import { updateAsciiMotion } from './ascii-motion.js';
import { buildAsciiNav, createScratchCanvas, drawAsciiNav } from './ascii-nav.js';

const COARSE_RAMP = ' .:-=+*#%@';
const FINE_RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const FONT = '11px "Share Tech Mono", "Courier New", monospace';
const CELL = 9;
const REVEAL_RADIUS = 120;
const REVEAL_FALLOFF = 175;
const REVEAL_FALLOFF_SQ = REVEAL_FALLOFF * REVEAL_FALLOFF;

// Water-wake ripples: dragging the cursor drops expanding wavelets along its
// path (like a leaf through water) that travel outward and fade.
const WAVE_SPEED = 150; // px/sec the ring expands
const WAVE_K = 0.09; // spatial frequency of the wave
const WAVE_TAU = 1.3; // sec amplitude e-fold decay
const WAVE_BAND = 40; // px ring thickness
export const MAX_RIPPLES = 8;

// Portrait tone: push contrast so the main page reads punchier, and color the
// glyphs along a warm duotone (deep plum shadows → amber highlights) so the
// ASCII has real tonal color instead of one flat ink.
const CONTRAST = 1.5;
const DUOTONE = (() => {
  const stops = [
    [0.0, [26, 20, 34]], // deep cool shadow
    [0.35, [96, 44, 52]], // maroon
    [0.62, [178, 92, 46]], // burnt orange
    [0.82, [214, 156, 92]], // amber
    [1.0, [220, 200, 165]], // page
  ];
  const N = 40;
  const out = new Array(N);
  for (let i = 0; i < N; i += 1) {
    const v = i / (N - 1);
    let a = stops[0];
    let c = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s += 1) {
      if (v >= stops[s][0] && v <= stops[s + 1][0]) {
        a = stops[s];
        c = stops[s + 1];
        break;
      }
    }
    const seg = (v - a[0]) / (c[0] - a[0] || 1);
    const r = Math.round(a[1][0] + (c[1][0] - a[1][0]) * seg);
    const g = Math.round(a[1][1] + (c[1][1] - a[1][1]) * seg);
    const b = Math.round(a[1][2] + (c[1][2] - a[1][2]) * seg);
    // Hex is the same colour as rgb() but parses faster as a fillStyle.
    out[i] = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  return out;
})();

function duotoneColor(b) {
  const i = Math.min(DUOTONE.length - 1, Math.max(0, Math.floor(b * DUOTONE.length)));
  return DUOTONE[i];
}

function applyContrast(v) {
  return (v - 0.5) * CONTRAST + 0.5;
}

function brightnessAt(data, i) {
  return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
}

function charFromRamp(ramp, brightness) {
  const t = 1 - brightness;
  const idx = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
  return ramp[idx];
}

function drawCover(ctx, img, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// Grid size for a canvas; the host repeats this to pre-sample the photo.
export function portraitGridSize(cssW, cssH, charWidth) {
  const baseCellW = Math.max(charWidth || CELL, CELL * 0.85);
  return {
    cols: Math.max(8, Math.floor(cssW / baseCellW)),
    rows: Math.max(8, Math.floor(cssH / CELL)),
  };
}

export function measurePortraitCharWidth(ctx) {
  ctx.font = FONT;
  return ctx.measureText('M').width;
}

// Downscaling an ImageBitmap filters differently from an <img>, so a worker
// is handed grids the page sampled from the <img> (env.grids) instead.
export function sampleGrid(img, cols, rows) {
  const off = createScratchCanvas(cols, rows);
  const ctx = off.getContext('2d', { willReadFrequently: true });
  drawCover(ctx, img, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);
  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) {
    grid[i] = brightnessAt(data, i * 4);
  }
  return grid;
}

// Hit boxes cross to the main thread every frame; keep only what it reads.
function slimBox(box) {
  return {
    id: box.id,
    href: box.href,
    external: box.external,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
  };
}

// `image` is an HTMLImageElement on the main thread or an ImageBitmap in a
// worker; `start` is the host's animation epoch in its performance.now() clock.
export function createPortraitCore(canvas, { image: img, reducedMotion, start }) {
  // No desynchronized/low-latency context here: on Windows Chrome it puts the
  // canvas on a low-latency swap chain that presents partially drawn frames,
  // which reads as heavy flicker on a full-viewport canvas.
  const ctx = canvas.getContext('2d');
  let pointer = { x: -9999, y: -9999, active: false };
  let cols = 0;
  let rows = 0;
  let coarse = null;
  let fine = null;
  let charWidth = 7;
  let letter = null;
  let halo = null;
  let regions = [];
  let letterHi = null;
  let hiCols = 0;
  let hiRows = 0;
  let hitBoxes = [];
  let hoveredId = -999;
  const ripples = [];
  let cssW = 1;
  let cssH = 1;
  let canvasDpr = 0;
  let cellW = 1;
  let cellH = 1;
  let centerX = null;
  let centerY = null;
  let waveSin = null;
  let waveCos = null;
  let cursor = 'crosshair';
  let glyphPainter;
  let viewportHeight = 1;
  const rippleSample = { b: 0, ox: 0, oy: 0 };
  let bg = '#dcc8a5';
  let fg = '#111';
  let accent = '#d95c16';

  // env: { cssW, cssH, dpr, colors: { bg, fg, accent }, navItems,
  // viewportWidth, viewportHeight }, measured by the host.
  function layout(env) {
    viewportHeight = env.viewportHeight;
    const dpr = env.dpr;
    const nextCssW = env.cssW;
    const nextCssH = env.cssH;
    if (nextCssW === cssW && nextCssH === cssH && dpr === canvasDpr && coarse) {
      return { changed: false, navEmbedded: regions.length >= 4 };
    }
    cssW = nextCssW;
    cssH = nextCssH;
    canvasDpr = dpr;

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    bg = env.colors.bg || bg;
    fg = env.colors.fg || fg;
    accent = env.colors.accent || accent;

    charWidth = measurePortraitCharWidth(ctx) || CELL;
    ({ cols, rows } = portraitGridSize(cssW, cssH, charWidth));
    cellW = cssW / cols;
    cellH = cssH / rows;
    glyphPainter = createGlyphPainter(ctx, FONT, cellW);
    centerX = new Float64Array(cols);
    centerY = new Float64Array(rows);
    waveSin = new Float64Array(cols * rows);
    waveCos = new Float64Array(cols * rows);
    for (let x = 0; x < cols; x += 1) centerX[x] = (x + 0.5) * cellW;
    for (let y = 0; y < rows; y += 1) {
      centerY[y] = (y + 0.5) * cellH;
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        const phase = x * 0.22 + y * 0.17;
        waveSin[index] = Math.sin(phase);
        waveCos[index] = Math.cos(phase);
      }
    }

    const grids = env.grids;
    if (grids && grids.cols === cols && grids.rows === rows) {
      ({ coarse, fine } = grids);
    } else {
      coarse = sampleGrid(img, cols, rows);
      fine = sampleGrid(img, cols * 2, rows * 2);
    }

    const ui = buildAsciiNav(cols, rows, env.navItems, env.viewportWidth);
    letter = ui.letter;
    halo = ui.halo;
    regions = ui.regions;
    letterHi = ui.letterHi;
    hiCols = ui.hiCols;
    hiRows = ui.hiRows;
    return { changed: true, navEmbedded: regions.length >= 4 };
  }

  function hitTest(px, py) {
    for (let i = hitBoxes.length - 1; i >= 0; i -= 1) {
      const b = hitBoxes[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
    }
    return null;
  }

  function draw(now) {
    if (!coarse || !letter) return null;

    const motion = updateAsciiMotion(now, start, reducedMotion);
    const { t, breath, scanNorm, driftX, driftY } = motion;

    // Advance and prune the wake wavelets without creating per-frame copies.
    const nowSec = (now - start) / 1000;
    let write = 0;
    if (!reducedMotion) {
      for (let index = 0; index < ripples.length; index += 1) {
        const ripple = ripples[index];
        const age = nowSec - ripple.t0;
        if (age >= WAVE_TAU * 3.2) continue;
        ripple.radius = age * WAVE_SPEED;
        ripple.amp = Math.exp(-age / WAVE_TAU);
        // A ripple only contributes where |d - radius| <= rippleCut. These
        // bounds (1px margin against rounding) let rippleField reject cells
        // the exact test would skip anyway, without the square root.
        ripple.outer = ripple.radius + WAVE_BAND * 2.5 + 1;
        const inner = ripple.radius - WAVE_BAND * 2.5 - 1;
        ripple.innerSq = inner > 0 ? inner * inner : -1;
        ripples[write] = ripple;
        write += 1;
      }
    }
    ripples.length = write;
    const rippleCut = WAVE_BAND * 2.5;
    // Sum the wavelet contributions at a point into one reused result.
    const rippleField = (px, py) => {
      let b = 0;
      let ox = 0;
      let oy = 0;
      for (let i = 0; i < ripples.length; i += 1) {
        const r = ripples[i];
        const dx = px - r.x;
        const dy = py - r.y;
        if (dx > r.outer || dx < -r.outer || dy > r.outer || dy < -r.outer) continue;
        if (dx * dx + dy * dy < r.innerSq) continue;
        const d = Math.hypot(dx, dy);
        const diff = d - r.radius;
        if (diff < -rippleCut || diff > rippleCut) continue;
        const env = Math.exp(-(diff * diff) / (2 * WAVE_BAND * WAVE_BAND)) * r.amp;
        const s = Math.sin(diff * WAVE_K) * env;
        b += s;
        if (d > 0.001) {
          ox += (dx / d) * s;
          oy += (dy / d) * s;
        }
      }
      rippleSample.b = b;
      rippleSample.ox = ox;
      rippleSample.oy = oy;
      return rippleSample;
    };

    const scanY = scanNorm * rows;
    const waveTime = t * 1.6;
    const waveTimeSin = Math.sin(waveTime);
    const waveTimeCos = Math.cos(waveTime);

    hitBoxes = regions.map((region) => {
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

    const hit = pointer.active ? hitTest(pointer.x, pointer.y) : null;
    hoveredId = hit ? hit.id : -999;
    cursor = hit ? 'pointer' : 'crosshair';

    const hoveredRegion = regions.find((r) => r.id === hoveredId) || null;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    if (pointer.active && !reducedMotion && !hit) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, REVEAL_RADIUS * 0.85, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.2 + Math.sin(t * 2.2) * 0.04;
      drawCover(ctx, img, cssW, cssH);
      ctx.restore();
    }

    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = fg;

    const hasRipples = ripples.length > 0;
    const revealing = pointer.active && !reducedMotion && !hit;
    const pointerX = pointer.x;
    const pointerY = pointer.y;
    const fineCols = cols * 2;

    for (let y = 0; y < rows; y += 1) {
      const rowIndex = y * cols;
      const band = Math.max(0, 1 - Math.abs(y - scanY) / 5);
      const cy = centerY[y];
      const rowY = y * cellH;
      const rowDriftX = driftX * (0.15 + band * 0.35);
      const rowDriftY = driftY * (0.1 + band * 0.25);
      const bandBrightness = band * 0.08;
      const inHoverRow = hoveredRegion
        && y >= hoveredRegion.minY && y <= hoveredRegion.maxY;
      const onHoverEdgeRow = inHoverRow
        && (y === hoveredRegion.minY || y === hoveredRegion.maxY);
      const dy = cy - pointerY;
      const dySq = dy * dy;

      for (let x = 0; x < cols; x += 1) {
        const idx = rowIndex + x;
        const L = letter[idx];
        const H = halo[idx];
        const inHoverBox = inHoverRow
          && x >= hoveredRegion.minX && x <= hoveredRegion.maxX;

        const wave = (waveSin[idx] * waveTimeCos + waveCos[idx] * waveTimeSin) * 0.03;

        const cx = centerX[x];
        // Outside the falloff the influence term clamps to zero anyway, so the
        // square root only has to run for cells inside the reveal disc.
        let influence = 0;
        if (revealing) {
          const dx = cx - pointerX;
          if (dx * dx + dySq < REVEAL_FALLOFF_SQ) {
            influence = Math.max(0, 1 - (Math.hypot(dx, dy) - REVEAL_RADIUS)
              / (REVEAL_FALLOFF - REVEAL_RADIUS));
          }
        }
        // Wake calculations are unnecessary until a ripple exists.
        const rf = hasRipples ? rippleField(cx, cy) : null;

        let b = applyContrast(coarse[idx]) + breath + wave + bandBrightness;
        let useFine = influence > 0.35;

        if (inHoverBox) {
          // solidify as ASCII panel: light field + dark border
          const onEdge = onHoverEdgeRow
            || x === hoveredRegion.minX
            || x === hoveredRegion.maxX;
          if (onEdge) b = 0.05;
          else b = 0.92;
          useFine = true;
        } else if (H > 0.2) {
          // clean carved cushion — a blank light plate; the actual letters are
          // painted on top at fine resolution in the nav pass below. The wake
          // still washes through it so the cursor stirs the blank areas too.
          b = Math.max(b, 0.95) + (rf ? rf.b * 0.08 : 0);
        } else if (rf) {
          b += rf.b * 0.22;
        }

        b = Math.min(1, Math.max(0, b));

        const isLetter = L > 0.15;
        let ch;
        if (useFine || isLetter) {
          if (influence > 0.35 && !isLetter) {
            const fx = Math.min(fineCols - 1, Math.floor((x + 0.5) * 2));
            const fy = Math.min(rows * 2 - 1, Math.floor((y + 0.5) * 2));
            b = Math.min(1, Math.max(0, fine[fy * fineCols + fx] + breath * 0.5 + wave));
          }
          ch = charFromRamp(FINE_RAMP, b);
        } else {
          ch = charFromRamp(COARSE_RAMP, b);
        }
        // A blank ramp step paints nothing, so the whole cell can be skipped.
        if (ch === ' ') continue;

        // the wake also sloshes cells radially, like water displacement
        const ox = rowDriftX * (influence > 0.2 ? 0.2 : 1)
          + (rf ? rf.ox * cellW * 0.85 : 0);
        const oy = rowDriftY + (rf ? rf.oy * cellH * 0.85 : 0);

        const alpha = useFine || isLetter
          ? (isLetter ? 0.95 : 0.65 + influence * 0.35)
          : 0.7 + band * 0.25 + influence * 0.2;
        const fillStyle = duotoneColor(b);
        glyphPainter.paint(ch, fillStyle, alpha, x * cellW + ox, rowY + oy);
      }
    }

    glyphPainter.finish();
    drawAsciiNav(ctx, {
      regions,
      letterHi,
      hiCols,
      hiRows,
    }, {
      cellW,
      cellH,
      motion,
      reducedMotion,
      hoveredId,
      foreground: fg,
      accent,
      rippleField,
      viewportHeight,
    });
    ctx.font = FONT;
    return { cursor, hitBoxes: hitBoxes.map(slimBox) };
  }

  return {
    layout,
    draw,
    setViewportHeight(height) {
      viewportHeight = height;
    },
    setPointer(next) {
      pointer = next;
      if (!next.active) hoveredId = -999;
    },
    addRipple(ripple) {
      ripples.push(ripple);
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    },
    snapshot() {
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    },
  };
}
