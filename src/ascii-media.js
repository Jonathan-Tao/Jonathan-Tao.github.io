const RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const FONT_FAMILY = '"Share Tech Mono", "Courier New", monospace';

// Warm duotone matching the home portrait so the ASCII logos/media share the
// same tonal color world as the main page.
const DUOTONE = (() => {
  const stops = [
    [0.0, [26, 20, 34]],
    [0.35, [96, 44, 52]],
    [0.62, [178, 92, 46]],
    [0.82, [214, 156, 92]],
    [1.0, [220, 200, 165]],
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

function brightnessAt(data, i) {
  return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
}

function charFromBrightness(brightness) {
  const t = 1 - brightness;
  const idx = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
  return RAMP[idx];
}

function contrastStretch(grid) {
  let min = 1;
  let max = 0;
  for (let i = 0; i < grid.length; i += 1) {
    const v = grid[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(0.08, max - min);
  const out = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i += 1) {
    out[i] = Math.min(1, Math.max(0, (grid[i] - min) / range));
  }
  return out;
}

function drawContain(ctx, source, w, h) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return false;
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.clearRect(0, 0, w, h);
  // page-colored matte so transparent SVG logos sample cleanly
  ctx.fillStyle = '#dcc8a5';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, dx, dy, dw, dh);
  return true;
}

function sampleFromSource(source, cols, rows) {
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  if (!drawContain(ctx, source, cols, rows)) return null;
  const { data } = ctx.getImageData(0, 0, cols, rows);
  const grid = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i += 1) {
    grid[i] = brightnessAt(data, i * 4);
  }
  return contrastStretch(grid);
}

function mountAsciiMedia(wrapper) {
  const source = wrapper.querySelector('.ascii-media-source');
  if (!source) return;
  if (source.tagName === 'VIDEO') {
    wrapper.classList.add('ascii-media-native-video');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'ascii-media-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  wrapper.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const isVideo = false;
  const isLogo = wrapper.classList.contains('ascii-media-logo');
  const cell = Number(wrapper.dataset.asciiCell) || (isLogo ? 4 : 6);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cols = 0;
  let rows = 0;
  let raf = 0;
  let running = false;

  function layout() {
    const rect = wrapper.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.max(8, Math.floor(cssW / cell));
    rows = Math.max(8, Math.floor(cssH / cell));
  }

  function paint(grid, t = 0) {
    const rect = wrapper.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const cellW = cssW / cols;
    const cellH = cssH / rows;
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
    const fontSize = Math.max(7, Math.floor(Math.min(cellW, cellH) * 0.95));

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = fg;

    const scan = (Math.sin(t * 0.0015) * 0.5 + 0.5) * rows;
    const motion = reducedMotion ? 0 : 1;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let b = grid[y * cols + x];
        const band = motion * (1 - Math.min(1, Math.abs(y - scan) / 6));
        b = Math.min(1, Math.max(0, b + band * 0.04));

        // keep near-white page matte empty so glyphs sit in the page
        if (b > 0.97) continue;

        const ch = charFromBrightness(b);
        // denser = darker = more opaque for readable form
        ctx.globalAlpha = 0.45 + (1 - b) * 0.55;
        ctx.fillStyle = duotoneColor(b);
        ctx.fillText(ch, x * cellW, y * cellH);
      }
    }
    ctx.globalAlpha = 1;
  }

  function renderFrame(t = 0) {
    if (!cols || !rows) return;
    const grid = sampleFromSource(source, cols, rows);
    if (!grid) return;
    paint(grid, t);
  }

  function loop(t) {
    raf = 0;
    if (!running) return;
    renderFrame(t);
    if (!reducedMotion) {
      raf = requestAnimationFrame(loop);
    }
  }

  function start() {
    if (running) return;
    running = true;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function ready() {
    layout();
    renderFrame(0);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (isVideo) source.play().catch(() => {});
          if (!reducedMotion) start();
          else renderFrame(0);
        } else {
          if (isVideo) source.pause();
          stop();
        }
      });
    }, { threshold: 0.15 });
    observer.observe(wrapper);
  }

  if (isVideo) {
    if (source.readyState >= 2) ready();
    else source.addEventListener('loadeddata', ready, { once: true });
  } else if (source.complete && source.naturalWidth) {
    ready();
  } else {
    source.addEventListener('load', ready, { once: true });
  }

  const resizeObserver = new ResizeObserver(() => {
    layout();
    renderFrame(performance.now());
  });
  resizeObserver.observe(wrapper);

  wrapper.classList.add('ascii-media-ready');
}

export function initAsciiMedia(root = document) {
  root.querySelectorAll('[data-ascii-media]').forEach(mountAsciiMedia);
}
