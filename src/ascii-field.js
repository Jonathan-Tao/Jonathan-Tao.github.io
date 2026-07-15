import { updateAsciiMotion } from './ascii-motion.js';
import {
  buildAsciiNav,
  buildNavHitBoxes,
  drawAsciiNav,
  hitTestAsciiNav,
} from './ascii-nav.js';

const COARSE_RAMP = ' .:-=+*#%@';
const FINE_RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const FONT = '11px "Share Tech Mono", "Courier New", monospace';
const CELL = 9;
const WAVE_SPEED = 150;
const WAVE_K = 0.09;
const WAVE_TAU = 1.3;
const WAVE_BAND = 40;
const MAX_RIPPLES = 8;

const DUOTONE = (() => {
  const stops = [
    [0, [26, 20, 34]],
    [0.35, [96, 44, 52]],
    [0.62, [178, 92, 46]],
    [0.82, [214, 156, 92]],
    [1, [244, 243, 239]],
  ];
  return Array.from({ length: 40 }, (_, index) => {
    const value = index / 39;
    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let stop = 0; stop < stops.length - 1; stop += 1) {
      if (value >= stops[stop][0] && value <= stops[stop + 1][0]) {
        lower = stops[stop];
        upper = stops[stop + 1];
        break;
      }
    }
    const amount = (value - lower[0]) / (upper[0] - lower[0] || 1);
    const channels = lower[1].map((channel, channelIndex) => (
      Math.round(channel + (upper[1][channelIndex] - channel) * amount)
    ));
    return `rgb(${channels.join(',')})`;
  });
})();

function charFromRamp(ramp, brightness) {
  const index = Math.min(ramp.length - 1, Math.floor((1 - brightness) * ramp.length));
  return ramp[index];
}

function duotoneColor(brightness) {
  const index = Math.min(DUOTONE.length - 1, Math.max(0, Math.floor(brightness * DUOTONE.length)));
  return DUOTONE[index];
}

export async function initAsciiField(mount) {
  if (!mount) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'ascii-field-canvas';
  canvas.setAttribute('aria-label', 'Interactive duotone ASCII background with site navigation');
  mount.appendChild(canvas);

  const context = canvas.getContext('2d');
  const start = performance.now();
  let cols = 0;
  let rows = 0;
  let field = null;
  let nav = null;
  let embeddedNav = false;
  let hitBoxes = [];
  let hoveredId = -999;
  let pointer = { x: -9999, y: -9999, active: false };
  let ripples = [];
  let resizeTimer;

  await document.fonts.load('60px "Share Tech Mono"').catch(() => {});

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.font = FONT;

    const charWidth = context.measureText('M').width || CELL;
    cols = Math.max(8, Math.floor(width / Math.max(charWidth, CELL * 0.85)));
    rows = Math.max(8, Math.floor(height / CELL));
    field = new Float32Array(cols * rows);

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const nx = x / cols;
        const ny = y / rows;
        const diagonal = Math.sin(nx * 9 + ny * 5) * 0.08;
        const columns = Math.cos(nx * 18 - ny * 3) * 0.055;
        const vignette = Math.hypot(nx - 0.56, ny - 0.46) * 0.22;
        field[y * cols + x] = Math.min(0.96, Math.max(0.46, 0.72 + diagonal + columns + vignette));
      }
    }

    nav = buildAsciiNav(cols, rows);
    embeddedNav = true;
    document.body.classList.toggle(
      'ascii-nav-embedded',
      embeddedNav && nav.regions.length >= 4,
    );
  }

  function activeRippleField(nowSeconds) {
    ripples = ripples.filter((ripple) => nowSeconds - ripple.t0 < WAVE_TAU * 3.2);
    const active = ripples.map((ripple) => {
      const age = nowSeconds - ripple.t0;
      return {
        ...ripple,
        radius: age * WAVE_SPEED,
        amplitude: Math.exp(-age / WAVE_TAU),
      };
    });
    return (x, y) => {
      let brightness = 0;
      let offsetX = 0;
      let offsetY = 0;
      active.forEach((ripple) => {
        const dx = x - ripple.x;
        const dy = y - ripple.y;
        const distance = Math.hypot(dx, dy);
        const difference = distance - ripple.radius;
        if (Math.abs(difference) > WAVE_BAND * 2.5) return;
        const envelope = Math.exp(-(difference ** 2) / (2 * WAVE_BAND ** 2)) * ripple.amplitude;
        const strength = Math.sin(difference * WAVE_K) * envelope;
        brightness += strength;
        if (distance > 0.001) {
          offsetX += (dx / distance) * strength;
          offsetY += (dy / distance) * strength;
        }
      });
      return { b: brightness, ox: offsetX, oy: offsetY };
    };
  }

  function draw(now) {
    if (!field || !nav) return;
    const motion = updateAsciiMotion(now, start, reducedMotion);
    const { t, breath, scanNorm, driftX, driftY } = motion;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cellW = width / cols;
    const cellH = height / rows;
    const scanY = scanNorm * rows;
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f4f3ef';
    const foreground = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1c1711';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5f05';
    const rippleField = activeRippleField((now - start) / 1000);

    hitBoxes = embeddedNav
      ? buildNavHitBoxes(nav.regions, cellW, cellH, motion, reducedMotion)
      : [];
    const hit = pointer.active ? hitTestAsciiNav(hitBoxes, pointer.x, pointer.y) : null;
    hoveredId = hit ? hit.id : -999;
    canvas.style.cursor = hit ? 'pointer' : 'crosshair';

    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.font = FONT;
    context.textBaseline = 'top';

    const hoveredRegion = nav.regions.find((region) => region.id === hoveredId);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        const wave = Math.sin(x * 0.22 + y * 0.17 + t * 1.6) * 0.03;
        const band = Math.max(0, 1 - Math.abs(y - scanY) / 6);
        const centerX = (x + 0.5) * cellW;
        const centerY = (y + 0.5) * cellH;
        const ripple = rippleField(centerX, centerY);
        const inHover = hoveredRegion
          && x >= hoveredRegion.minX && x <= hoveredRegion.maxX
          && y >= hoveredRegion.minY && y <= hoveredRegion.maxY;

        let brightness = field[index] + breath + wave + band * 0.07 + ripple.b * 0.2;
        if (inHover) {
          const edge = x === hoveredRegion.minX || x === hoveredRegion.maxX
            || y === hoveredRegion.minY || y === hoveredRegion.maxY;
          brightness = edge ? 0.05 : 0.92;
        } else if (embeddedNav && nav.halo[index] > 0.2) {
          brightness = Math.max(brightness, 0.96);
        }
        brightness = Math.min(1, Math.max(0, brightness));

        const distance = Math.hypot(centerX - pointer.x, centerY - pointer.y);
        const nearPointer = pointer.active && !hit && distance < 170;
        const glyph = charFromRamp(nearPointer ? FINE_RAMP : COARSE_RAMP, brightness);
        const offsetX = driftX * (0.15 + band * 0.35) + ripple.ox * cellW * 0.8;
        const offsetY = driftY * (0.1 + band * 0.25) + ripple.oy * cellH * 0.8;
        context.fillStyle = duotoneColor(brightness);
        context.globalAlpha = nearPointer ? 0.88 : 0.58 + band * 0.2;
        context.fillText(glyph, x * cellW + offsetX, y * cellH + offsetY);
      }
    }

    if (embeddedNav) {
      drawAsciiNav(context, nav, {
        cellW,
        cellH,
        motion,
        reducedMotion,
        hoveredId,
        foreground,
        accent,
        rippleField,
      });
    }

    context.globalAlpha = 1;
    window.dispatchEvent(new CustomEvent('ascii-frame', { detail: motion }));
  }

  function frame(now) {
    draw(now);
    if (!reducedMotion) requestAnimationFrame(frame);
  }

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
  }

  function clearPointer() {
    pointer = { x: -9999, y: -9999, active: false };
    hoveredId = -999;
  }

  function spawnRipple(event) {
    updatePointer(event);
    if (reducedMotion) return;
    ripples.push({
      x: pointer.x,
      y: pointer.y,
      t0: (performance.now() - start) / 1000,
    });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
  }

  // Listen at window level so the field continues reacting while the pointer
  // is over readable page content layered above the canvas.
  window.addEventListener('pointermove', updatePointer, { passive: true });
  window.addEventListener('pointerdown', spawnRipple, { passive: true });
  window.addEventListener('blur', clearPointer);
  document.documentElement.addEventListener('mouseleave', clearPointer);

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const target = hitTestAsciiNav(
      hitBoxes,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (target) {
      window.dispatchEvent(new CustomEvent('ascii-navigate', {
        detail: { href: target.href },
      }));
    }
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layout();
      if (reducedMotion) draw(performance.now());
    }, 120);
  });

  layout();
  if (reducedMotion) draw(performance.now());
  else requestAnimationFrame(frame);
  mount.classList.add('ascii-field-ready');
}
