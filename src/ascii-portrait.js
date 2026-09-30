// Home-page ASCII portrait host: DOM, events and frame timing. Drawing lives
// in portrait-core.js and runs in a worker when OffscreenCanvas is available.
import { createAsciiRenderer } from './ascii-renderer.js';
import { hitTestAsciiNav, readNavItems } from './ascii-nav.js';
import { measurePortraitCharWidth, portraitGridSize, sampleGrid } from './portrait-core.js';

const PHOTO_SRC = '/currentPhoto.webp';
const FRAME_INTERVAL = 1000 / 30;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load portrait'));
    img.src = src;
  });
}

function readColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bg: styles.getPropertyValue('--bg').trim(),
    fg: styles.getPropertyValue('--text').trim(),
    accent: styles.getPropertyValue('--accent').trim(),
  };
}

export async function initAsciiPortrait(mount) {
  if (!mount) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas = document.createElement('canvas');
  canvas.className = 'ascii-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'ASCII portrait of Jonathan Tao with embedded navigation',
  );
  mount.appendChild(canvas);

  let img;
  try {
    [img] = await Promise.all([
      loadImage(PHOTO_SRC),
      document.fonts.load('60px "Share Tech Mono"').catch(() => {}),
    ]);
  } catch {
    mount.classList.add('ascii-failed');
    return;
  }

  const start = performance.now();
  let raf = 0;
  let lastFrame = 0;
  let hitBoxes = [];
  let cursor = 'crosshair';
  let cachedRect = null;
  let navEmbedded = false;
  let firstFrame;
  const firstFramePainted = new Promise((resolve) => {
    firstFrame = resolve;
  });

  const renderer = await createAsciiRenderer({
    kind: 'portrait',
    canvas,
    image: img,
    reducedMotion,
    start,
    onLayout(result) {
      navEmbedded = result.navEmbedded;
      if (result.changed) document.body.classList.toggle('ascii-nav-embedded', navEmbedded);
    },
    onFrame(result) {
      firstFrame();
      if (!result) return;
      hitBoxes = result.hitBoxes;
      if (result.cursor !== cursor) {
        cursor = result.cursor;
        canvas.style.cursor = cursor;
      }
    },
  });
  canvas = renderer.canvas;

  // Worker mode only: sample the photo grids here, from the <img>, whenever
  // the worker will rebuild its layout (see sampleGrid in portrait-core.js).
  const measureContext = renderer.inWorker ? document.createElement('canvas').getContext('2d') : null;
  let lastLayoutKey = '';
  let grids = null;

  function photoGrids(cssW, cssH) {
    const { cols, rows } = portraitGridSize(cssW, cssH, measurePortraitCharWidth(measureContext));
    if (!grids || grids.cols !== cols || grids.rows !== rows) {
      grids = {
        cols,
        rows,
        coarse: sampleGrid(img, cols, rows),
        fine: sampleGrid(img, cols * 2, rows * 2),
      };
    }
    return grids;
  }

  function layout() {
    cachedRect = null;
    const rect = mount.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const layoutKey = `${cssW}x${cssH}@${dpr}`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    renderer.layout({
      cssW,
      cssH,
      dpr,
      colors: readColors(),
      navItems: readNavItems(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      grids: renderer.inWorker && layoutKey !== lastLayoutKey ? photoGrids(cssW, cssH) : null,
    });
    lastLayoutKey = layoutKey;
  }

  function draw(now) {
    renderer.frame(now);
  }

  function requestFrame() {
    if (!reducedMotion && !document.hidden && !raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (document.hidden) return;
    // A worker still drawing the previous frame: try again next vsync.
    if (!renderer.busy && now - lastFrame >= FRAME_INTERVAL) {
      lastFrame = now - ((now - lastFrame) % FRAME_INTERVAL);
      draw(now);
    }
    requestFrame();
  }

  layout();
  // Publish readiness only after the first frame is painted.
  draw(performance.now());
  requestFrame();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!document.hidden) requestFrame();
  });

  new ResizeObserver(() => {
    layout();
    if (reducedMotion) draw(performance.now());
  }).observe(mount);

  // getBoundingClientRect forces layout, so caching it keeps pointermove off
  // the layout path. Resize, scroll and relayout drop the cached rect.
  const canvasRect = () => {
    if (!cachedRect) cachedRect = canvas.getBoundingClientRect();
    return cachedRect;
  };
  const dropCachedRect = () => {
    cachedRect = null;
  };
  window.addEventListener('scroll', dropCachedRect, { passive: true });
  window.addEventListener('resize', () => {
    dropCachedRect();
    renderer.setViewportHeight(window.innerHeight);
  }, { passive: true });

  const onMove = (clientX, clientY) => {
    const rect = canvasRect();
    renderer.setPointer({ x: clientX - rect.left, y: clientY - rect.top, active: true });
  };

  // a click drops a single wavelet that rings outward from the point pressed
  const spawnRipple = (clientX, clientY) => {
    if (reducedMotion) return;
    const rect = canvasRect();
    renderer.addRipple({
      x: clientX - rect.left,
      y: clientY - rect.top,
      t0: (performance.now() - start) / 1000,
    });
  };

  canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerenter', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerleave', () => {
    renderer.setPointer({ x: -9999, y: -9999, active: false });
  });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    onMove(e.clientX, e.clientY);
    spawnRipple(e.clientX, e.clientY);
  });
  canvas.addEventListener('click', (e) => {
    const rect = canvasRect();
    const target = hitTestAsciiNav(hitBoxes, e.clientX - rect.left, e.clientY - rect.top);
    if (!target) return;
    if (target.external) window.open(target.href, '_blank', 'noopener,noreferrer');
    else {
      window.dispatchEvent(new CustomEvent('ascii-navigate', {
        detail: { href: target.href },
      }));
    }
  });

  await firstFramePainted;
  mount.classList.add('ascii-ready');
  document.body.classList.toggle('ascii-nav-embedded', navEmbedded);
}
