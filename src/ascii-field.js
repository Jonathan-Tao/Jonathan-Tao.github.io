// Inner-page ASCII background host: DOM, events and frame timing. Drawing
// lives in field-core.js and runs in a worker when OffscreenCanvas is
// available.
import { createAsciiRenderer } from './ascii-renderer.js';
import { hitTestAsciiNav, readNavItems } from './ascii-nav.js';
import {
  documentIsFullscreen,
  shouldFreezeFullscreenLayout,
  onFullscreenLayoutResume,
} from './fullscreen-guard.js';

const FRAME_INTERVAL = 1000 / 24;

function readColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bg: styles.getPropertyValue('--bg').trim(),
    fg: styles.getPropertyValue('--text').trim(),
    accent: styles.getPropertyValue('--accent').trim(),
  };
}

export async function initAsciiField(mount) {
  if (!mount) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let canvas = document.createElement('canvas');
  canvas.className = 'ascii-field-canvas';
  canvas.setAttribute('aria-label', 'Interactive duotone ASCII background with site navigation');
  mount.appendChild(canvas);

  const start = performance.now();
  let hitBoxes = [];
  let pointer = { x: -9999, y: -9999, active: false };
  let resizeTimer;
  let lastFrame = 0;
  let raf = 0;
  let cursor = 'crosshair';
  let cachedRect = null;
  let firstFrame;
  const firstFramePainted = new Promise((resolve) => {
    firstFrame = resolve;
  });

  await document.fonts.load('60px "Share Tech Mono"').catch(() => {});

  const renderer = await createAsciiRenderer({
    kind: 'field',
    canvas,
    reducedMotion,
    start,
    onLayout(result) {
      if (result.changed) document.body.classList.toggle('ascii-nav-embedded', result.navEmbedded);
    },
    onFrame(result) {
      firstFrame();
      if (!result) return;
      hitBoxes = result.hitBoxes;
      if (result.cursor !== cursor) {
        cursor = result.cursor;
        canvas.style.cursor = cursor;
      }
      if (!document.body.classList.contains('ascii-nav-embedded')) {
        window.dispatchEvent(new CustomEvent('ascii-frame', { detail: result.motion }));
      }
    },
  });
  canvas = renderer.canvas;

  function layout() {
    cachedRect = null;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    renderer.layout({
      cssW: width,
      cssH: height,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      colors: readColors(),
      navItems: readNavItems(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  }

  function draw(now) {
    renderer.frame(now);
  }

  function requestFrame() {
    if (!reducedMotion && !document.hidden && !shouldFreezeFullscreenLayout() && !raf) {
      raf = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    raf = 0;
    if (document.hidden || shouldFreezeFullscreenLayout()) return;
    // A worker still drawing the previous frame: try again next vsync.
    if (!renderer.busy && now - lastFrame >= FRAME_INTERVAL) {
      lastFrame = now - ((now - lastFrame) % FRAME_INTERVAL);
      draw(now);
    }
    requestFrame();
  }

  function eventTargetsControl(event) {
    return event.composedPath().some((target) => (
      target instanceof Element
      && target.matches('video, button, a, input, select, textarea, [role="button"]')
    ));
  }

  // getBoundingClientRect forces layout, so caching it keeps pointermove off
  // the layout path. The canvas is viewport-fixed, so only a resize moves it.
  function canvasRect() {
    if (!cachedRect) cachedRect = canvas.getBoundingClientRect();
    return cachedRect;
  }

  function updatePointer(event) {
    const rect = canvasRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
    renderer.setPointer(pointer);
  }

  function clearPointer() {
    pointer = { x: -9999, y: -9999, active: false };
    renderer.setPointer(pointer);
  }

  function spawnRipple(event) {
    if (eventTargetsControl(event)) return;
    updatePointer(event);
    if (reducedMotion) return;
    renderer.addRipple({
      x: pointer.x,
      y: pointer.y,
      t0: (performance.now() - start) / 1000,
    });
  }

  // Listen at window level so the field continues reacting while the pointer
  // is over readable page content layered above the canvas.
  window.addEventListener('pointermove', updatePointer, { passive: true });
  window.addEventListener('pointerdown', spawnRipple, { passive: true });
  window.addEventListener('blur', clearPointer);
  document.documentElement.addEventListener('mouseleave', clearPointer);

  window.addEventListener('click', (event) => {
    if (eventTargetsControl(event)) return;
    const rect = canvasRect();
    const target = hitTestAsciiNav(
      hitBoxes,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('ascii-navigate', {
        detail: { href: target.href },
      }));
    }
  }, true);

  window.addEventListener('resize', () => {
    cachedRect = null;
    renderer.setViewportHeight(window.innerHeight);
    clearTimeout(resizeTimer);
    // Video fullscreen fires a resize storm before fullscreenElement is set.
    // Debounce rebuilds; the freeze guard skips work during the transition.
    resizeTimer = setTimeout(() => {
      if (shouldFreezeFullscreenLayout()) return;
      layout();
      if (reducedMotion) draw(performance.now());
      else requestFrame();
    }, 180);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!document.hidden) requestFrame();
  });
  const handleFullscreenChange = () => {
    if (documentIsFullscreen()) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      return;
    }
    layout();
    if (reducedMotion) draw(performance.now());
    else requestFrame();
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  onFullscreenLayoutResume(() => {
    if (documentIsFullscreen()) return;
    layout();
    if (reducedMotion) draw(performance.now());
    else requestFrame();
  });

  layout();
  draw(performance.now());
  requestFrame();
  await firstFramePainted;
  mount.classList.add('ascii-field-ready');
}
