import { asciiMotion, updateAsciiMotion } from './ascii-motion.js';
import { buildAsciiNav, drawAsciiNav } from './ascii-nav.js';

const COARSE_RAMP = ' .:-=+*#%@';
const FINE_RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
// a clean, tidy ramp for the nav letterforms — no busy punctuation
const NAV_RAMP = ' .:-=+*oO#%@';
const PHOTO_SRC = '/currentPhoto.JPG';
const FONT = '11px "Share Tech Mono", "Courier New", monospace';
const CELL = 9;
const REVEAL_RADIUS = 120;
const REVEAL_FALLOFF = 175;
const UI_SCALE = 8;
// nav letters are rendered on a sub-grid HI× finer than the portrait grid, so
// each letter is built from smaller glyphs (higher HI = more, tinier glyphs;
// UI_SCALE must divide evenly by HI)
const HI = 2;

// Water-wake ripples: dragging the cursor drops expanding wavelets along its
// path (like a leaf through water) that travel outward and fade.
const WAVE_SPEED = 150; // px/sec the ring expands
const WAVE_K = 0.09; // spatial frequency of the wave
const WAVE_TAU = 1.3; // sec amplitude e-fold decay
const WAVE_BAND = 40; // px ring thickness
const MAX_RIPPLES = 8;

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
    [1.0, [244, 243, 239]], // page
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
    out[i] = `rgb(${r},${g},${b})`;
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load portrait'));
    img.src = src;
  });
}

function drawCover(ctx, img, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function sampleGrid(img, cols, rows) {
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  drawCover(ctx, img, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);
  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) {
    grid[i] = brightnessAt(data, i * 4);
  }
  return grid;
}

function readNavItems() {
  return [...document.querySelectorAll('#site-nav a')].map((a) => ({
    label: a.textContent.replace(/\s+/g, ' ').trim().toUpperCase(),
    href: a.getAttribute('href') || '/',
    current: a.getAttribute('aria-current') === 'page',
  }));
}

function dilate(src, cols, rows, radius = 1) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let m = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          m = Math.max(m, src[ny * cols + nx]);
        }
      }
      out[y * cols + x] = m;
    }
  }
  return out;
}

function buildUiMasks(cols, rows) {
  const letter = new Float32Array(cols * rows);
  const idMap = new Int16Array(cols * rows);
  idMap.fill(-1);
  const hiCols = cols * HI;
  const hiRows = rows * HI;
  const letterHi = new Float32Array(hiCols * hiRows);
  const hiCell = UI_SCALE / HI;
  const regions = [];

  const w = cols * UI_SCALE;
  const h = rows * UI_SCALE;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = '#000';
  octx.fillRect(0, 0, w, h);
  octx.fillStyle = '#fff';
  octx.textBaseline = 'top';
  octx.textAlign = 'left';

  const jobs = [];

  function queueText(text, fontPx, gridX, gridY, meta) {
    jobs.push({ text, fontPx, gridX, gridY, meta });
  }

  // anchor the nav's left edge at ~18% of the page width, so it holds that
  // position regardless of screen size
  const navX = Math.round(cols * 0.18);

  // step must clear the cap height (~0.75 * fontPx grid rows) or the words
  // overlap vertically and turn to mush
  let cursorY = 5;
  readNavItems().forEach((item, i) => {
    queueText(item.label, 4.5, navX, cursorY, {
      id: i,
      href: item.href,
      kind: 'nav',
      current: item.current,
    });
    cursorY += 5.4;
  });

  // Draw each label alone, sample bounds, accumulate into letter mask
  jobs.forEach((job) => {
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, w, h);
    octx.fillStyle = '#fff';
    octx.font = `${job.fontPx * UI_SCALE}px "Share Tech Mono", "Courier New", monospace`;
    // space the letters out so words read airily, like a normal nav
    octx.letterSpacing = job.meta.kind === 'nav'
      ? `${job.fontPx * UI_SCALE * 0.22}px`
      : '0px';
    octx.fillText(job.text, job.gridX * UI_SCALE, job.gridY * UI_SCALE);
    const { data } = octx.getImageData(0, 0, w, h);

    // fine sub-grid coverage — many small cells per letter for crisp ASCII text
    for (let hy = 0; hy < hiRows; hy += 1) {
      for (let hx = 0; hx < hiCols; hx += 1) {
        let hsum = 0;
        const hx0 = hx * hiCell;
        const hy0 = hy * hiCell;
        for (let sy = 0; sy < hiCell; sy += 1) {
          for (let sx = 0; sx < hiCell; sx += 1) {
            hsum += data[((hy0 + sy) * w + (hx0 + sx)) * 4] / 255;
          }
        }
        const ha = hsum / (hiCell * hiCell);
        if (ha < 0.14) continue;
        const hidx = hy * hiCols + hx;
        if (ha > letterHi[hidx]) letterHi[hidx] = ha;
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
            sum += data[((y0 + sy) * w + (x0 + sx)) * 4] / 255;
          }
        }
        const a = sum / (UI_SCALE * UI_SCALE);
        if (a < 0.18) continue;
        found = true;
        const idx = y * cols + x;
        letter[idx] = Math.max(letter[idx], a);
        idMap[idx] = job.meta.id;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (!found) return;

    // pad hit region
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(cols - 1, maxX + 1);
    maxY = Math.min(rows - 1, maxY + 1);

    regions.push({
      ...job.meta,
      label: job.text,
      minX,
      minY,
      maxX,
      maxY,
    });
  });

  const halo = dilate(letter, cols, rows, 1);
  return { letter, halo, idMap, regions, letterHi, hiCols, hiRows };
}

export async function initAsciiPortrait(mount) {
  if (!mount) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'ascii-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'ASCII portrait of Jonathan Tao with embedded navigation',
  );
  mount.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let img;
  try {
    img = await loadImage(PHOTO_SRC);
  } catch {
    mount.classList.add('ascii-failed');
    return;
  }

  await document.fonts.load('60px "Share Tech Mono"').catch(() => {});

  let pointer = { x: -9999, y: -9999, active: false };
  let cols = 0;
  let rows = 0;
  let coarse = null;
  let fine = null;
  let charWidth = 7;
  let raf = 0;
  let start = performance.now();
  let letter = null;
  let halo = null;
  let idMap = null;
  let regions = [];
  let letterHi = null;
  let hiCols = 0;
  let hiRows = 0;
  let hitBoxes = [];
  let hoveredId = -999;
  let ripples = [];

  function layout() {
    const rect = mount.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.font = FONT;
    charWidth = ctx.measureText('M').width || CELL;
    const cellW = Math.max(charWidth, CELL * 0.85);
    const cellH = CELL;
    cols = Math.max(8, Math.floor(cssW / cellW));
    rows = Math.max(8, Math.floor(cssH / cellH));

    coarse = sampleGrid(img, cols, rows);
    fine = sampleGrid(img, cols * 2, rows * 2);

    const ui = buildAsciiNav(cols, rows);
    letter = ui.letter;
    halo = ui.halo;
    idMap = ui.idMap;
    regions = ui.regions;
    letterHi = ui.letterHi;
    hiCols = ui.hiCols;
    hiRows = ui.hiRows;
    document.body.classList.toggle('ascii-nav-embedded', regions.length >= 4);
  }

  function hitTest(px, py) {
    for (let i = hitBoxes.length - 1; i >= 0; i -= 1) {
      const b = hitBoxes[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
    }
    return null;
  }

  function draw(now) {
    if (!coarse || !letter) return;

    const motion = updateAsciiMotion(now, start, reducedMotion);
    const { t, breath, scanNorm, driftX, driftY } = motion;

    // Advance / prune the wake wavelets and precompute each one's current
    // radius and amplitude for this frame.
    const nowSec = (now - start) / 1000;
    let activeRipples = [];
    if (!reducedMotion && ripples.length) {
      ripples = ripples.filter((r) => nowSec - r.t0 < WAVE_TAU * 3.2);
      activeRipples = ripples.map((r) => {
        const age = nowSec - r.t0;
        return { x: r.x, y: r.y, radius: age * WAVE_SPEED, amp: Math.exp(-age / WAVE_TAU) };
      });
    }
    const rippleCut = WAVE_BAND * 2.5;
    // Sum the wavelet contributions at a point: brightness disturbance + a
    // radial push vector, so the field both shimmers and sloshes like water.
    const rippleField = (px, py) => {
      let b = 0;
      let ox = 0;
      let oy = 0;
      for (let i = 0; i < activeRipples.length; i += 1) {
        const r = activeRipples[i];
        const dx = px - r.x;
        const dy = py - r.y;
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
      return { b, ox, oy };
    };

    const rect = mount.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const cellW = cssW / cols;
    const cellH = cssH / rows;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f4f3ef';
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5f05';
    const scanY = scanNorm * rows;

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
    canvas.style.cursor = hit ? 'pointer' : 'crosshair';

    // per-frame overrides for hover solidify (still ASCII cells, not DOM boxes)
    const boxOn = new Uint8Array(cols * rows);
    const hoveredRegion = regions.find((r) => r.id === hoveredId) || null;
    if (hoveredRegion) {
      for (let y = hoveredRegion.minY; y <= hoveredRegion.maxY; y += 1) {
        for (let x = hoveredRegion.minX; x <= hoveredRegion.maxX; x += 1) {
          boxOn[y * cols + x] = 1;
        }
      }
    }

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

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = y * cols + x;
        const L = letter[idx];
        const H = halo[idx];
        const uid = idMap[idx];
        const inHoverBox = boxOn[idx] === 1;
        const isCurrent = regions.some((r) => r.id === uid && r.current);

        const wave = Math.sin(x * 0.22 + y * 0.17 + t * 1.6) * 0.03;
        const band = Math.max(0, 1 - Math.abs(y - scanY) / 5);
        // no random per-cell flicker — it read as noise
        const flicker = 0;

        const cx = (x + 0.5) * cellW;
        const cy = (y + 0.5) * cellH;
        const dist = Math.hypot(cx - pointer.x, cy - pointer.y);
        const influence = pointer.active && !reducedMotion && !hit
          ? Math.max(0, 1 - (dist - REVEAL_RADIUS) / (REVEAL_FALLOFF - REVEAL_RADIUS))
          : 0;
        // wake disturbance from passing wavelets at this cell
        const rf = rippleField(cx, cy);

        let b = applyContrast(coarse[idx]) + breath + wave + band * 0.08 + flicker;
        let useFine = influence > 0.35;

        if (inHoverBox && hoveredRegion) {
          // solidify as ASCII panel: light field + dark border
          const onEdge = x === hoveredRegion.minX
            || x === hoveredRegion.maxX
            || y === hoveredRegion.minY
            || y === hoveredRegion.maxY;
          if (onEdge) b = 0.05;
          else b = 0.92;
          useFine = true;
        } else if (H > 0.2) {
          // clean carved cushion — a blank light plate; the actual letters are
          // painted on top at fine resolution in the nav pass below. The wake
          // still washes through it so the cursor stirs the blank areas too.
          b = Math.max(b, 0.95) + rf.b * 0.08;
        } else {
          b += rf.b * 0.22;
        }

        b = Math.min(1, Math.max(0, b));

        // the wake also sloshes cells radially, like water displacement
        const ox = driftX * (0.15 + band * 0.35) * (influence > 0.2 ? 0.2 : 1)
          + rf.ox * cellW * 0.85;
        const oy = driftY * (0.1 + band * 0.25)
          + rf.oy * cellH * 0.85;

        let ch;
        if (useFine || L > 0.15) {
          if (influence > 0.35 && L < 0.15) {
            const fx = Math.min(cols * 2 - 1, Math.floor((x + 0.5) * 2));
            const fy = Math.min(rows * 2 - 1, Math.floor((y + 0.5) * 2));
            b = Math.min(1, Math.max(0, fine[fy * cols * 2 + fx] + breath * 0.5 + wave));
          }
          ch = charFromRamp(FINE_RAMP, b);
          ctx.globalAlpha = L > 0.15 ? 0.95 : 0.65 + influence * 0.35;
        } else {
          ch = charFromRamp(COARSE_RAMP, b);
          ctx.globalAlpha = 0.7 + band * 0.25 + influence * 0.2;
        }

        ctx.fillStyle = duotoneColor(b);
        ctx.fillText(ch, x * cellW + ox, y * cellH + oy);
      }
    }

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
    });
    ctx.font = FONT;

    window.dispatchEvent(new CustomEvent('ascii-frame', { detail: { ...asciiMotion } }));
  }

  function frame(now) {
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  layout();
  if (reducedMotion) draw(performance.now());
  else raf = requestAnimationFrame(frame);

  new ResizeObserver(() => layout()).observe(mount);

  const onMove = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: clientX - rect.left, y: clientY - rect.top, active: true };
  };

  // a click drops a single wavelet that rings outward from the point pressed
  const spawnRipple = (clientX, clientY) => {
    if (reducedMotion) return;
    const rect = canvas.getBoundingClientRect();
    ripples.push({
      x: clientX - rect.left,
      y: clientY - rect.top,
      t0: (performance.now() - start) / 1000,
    });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
  };

  canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerenter', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerleave', () => {
    pointer = { x: -9999, y: -9999, active: false };
    hoveredId = -999;
  });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    onMove(e.clientX, e.clientY);
    spawnRipple(e.clientX, e.clientY);
  });
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const target = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!target) return;
    if (target.external) window.open(target.href, '_blank', 'noopener,noreferrer');
    else {
      window.dispatchEvent(new CustomEvent('ascii-navigate', {
        detail: { href: target.href },
      }));
    }
  });

  mount.classList.add('ascii-ready');
  document.body.classList.toggle('ascii-nav-embedded', regions.length >= 4);
}
