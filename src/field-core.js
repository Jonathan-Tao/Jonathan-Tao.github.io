// Inner-page ASCII background renderer. It has no DOM access, so the same
// code can draw into an OffscreenCanvas in a worker or into a <canvas> on the
// main thread. ascii-field.js owns events, timing and layout measurements.
import { createGlyphPainter } from './ascii-glyph-painter.js';
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
export const MAX_RIPPLES = 8;
const NEAR_POINTER = 170;
const NEAR_POINTER_SQ = NEAR_POINTER * NEAR_POINTER;
const RIPPLE_CUT = WAVE_BAND * 2.5;

const DUOTONE = (() => {
  const stops = [
    [0, [26, 20, 34]],
    [0.35, [96, 44, 52]],
    [0.62, [178, 92, 46]],
    [0.82, [214, 156, 92]],
    [1, [220, 200, 165]],
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
    // Hex is the same colour as rgb() but parses faster as a fillStyle.
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  });
})();

function charFromRamp(ramp, brightness) {
  const index = Math.min(ramp.length - 1, Math.floor((1 - brightness) * ramp.length));
  return ramp[index];
}

// A ripple only contributes where |distance - radius| <= RIPPLE_CUT. These
// bounds (with a 1px margin against rounding) reject cells that the exact test
// would skip anyway, without computing the square root.
function setRippleBounds(ripple) {
  ripple.outer = ripple.radius + RIPPLE_CUT + 1;
  const inner = ripple.radius - RIPPLE_CUT - 1;
  ripple.innerSq = inner > 0 ? inner * inner : -1;
}

function rippleMayReach(ripple, dx, dy) {
  if (dx > ripple.outer || dx < -ripple.outer || dy > ripple.outer || dy < -ripple.outer) return false;
  return dx * dx + dy * dy >= ripple.innerSq;
}

function duotoneColor(brightness) {
  const index = Math.min(DUOTONE.length - 1, Math.max(0, Math.floor(brightness * DUOTONE.length)));
  return DUOTONE[index];
}

// Hit boxes cross to the main thread every frame; keep only what it reads.
function slimBox(box) {
  return {
    id: box.id,
    href: box.href,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
  };
}

// `start` is the host's animation epoch in its performance.now() clock.
export function createFieldCore(canvas, { reducedMotion, start }) {
  // No desynchronized/low-latency context here: on Windows Chrome it puts the
  // canvas on a low-latency swap chain that presents partially drawn frames,
  // which reads as heavy flicker on a full-viewport canvas.
  const context = canvas.getContext('2d');
  let cols = 0;
  let rows = 0;
  let field = null;
  let nav = null;
  let embeddedNav = false;
  let hitBoxes = [];
  let hoveredId = -999;
  let pointer = { x: -9999, y: -9999, active: false };
  const ripples = [];
  let canvasDpr = 0;
  let cssWidth = 1;
  let cssHeight = 1;
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
  let background = '#dcc8a5';
  let foreground = '#2a1d13';
  let accent = '#d95c16';

  // env: { cssW, cssH, dpr, colors: { bg, fg, accent }, navItems,
  // viewportWidth, viewportHeight }, measured by the host.
  function layout(env) {
    viewportHeight = env.viewportHeight;
    const dpr = env.dpr;
    const width = env.cssW;
    const height = env.cssH;
    if (field && width === cssWidth && height === cssHeight && dpr === canvasDpr) {
      return { changed: false, navEmbedded: embeddedNav && nav.regions.length >= 4 };
    }
    canvasDpr = dpr;
    cssWidth = width;
    cssHeight = height;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.font = FONT;

    background = env.colors.bg || background;
    foreground = env.colors.fg || foreground;
    accent = env.colors.accent || accent;

    const charWidth = context.measureText('M').width || CELL;
    cols = Math.max(8, Math.floor(width / Math.max(charWidth, CELL * 0.85)));
    rows = Math.max(8, Math.floor(height / CELL));
    cellW = width / cols;
    cellH = height / rows;
    glyphPainter = createGlyphPainter(context, FONT, cellW);
    centerX = new Float64Array(cols);
    centerY = new Float64Array(rows);
    field = new Float32Array(cols * rows);
    waveSin = new Float64Array(cols * rows);
    waveCos = new Float64Array(cols * rows);

    for (let x = 0; x < cols; x += 1) centerX[x] = (x + 0.5) * cellW;
    for (let y = 0; y < rows; y += 1) {
      centerY[y] = (y + 0.5) * cellH;
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        const nx = x / cols;
        const ny = y / rows;
        const diagonal = Math.sin(nx * 9 + ny * 5) * 0.08;
        const columns = Math.cos(nx * 18 - ny * 3) * 0.055;
        const vignette = Math.hypot(nx - 0.56, ny - 0.46) * 0.22;
        const phase = x * 0.22 + y * 0.17;
        field[index] = Math.min(0.96, Math.max(0.46, 0.72 + diagonal + columns + vignette));
        waveSin[index] = Math.sin(phase);
        waveCos[index] = Math.cos(phase);
      }
    }


    nav = buildAsciiNav(cols, rows, env.navItems, env.viewportWidth);
    embeddedNav = true;
    return { changed: true, navEmbedded: embeddedNav && nav.regions.length >= 4 };
  }

  function updateRipples(nowSeconds) {
    let write = 0;
    for (let index = 0; index < ripples.length; index += 1) {
      const ripple = ripples[index];
      const age = nowSeconds - ripple.t0;
      if (age >= WAVE_TAU * 3.2) continue;
      ripple.radius = age * WAVE_SPEED;
      ripple.amplitude = Math.exp(-age / WAVE_TAU);
      setRippleBounds(ripple);
      ripples[write] = ripple;
      write += 1;
    }
    ripples.length = write;
  }

  function sampleRipple(x, y) {
    let brightness = 0;
    let offsetX = 0;
    let offsetY = 0;
    for (let index = 0; index < ripples.length; index += 1) {
      const ripple = ripples[index];
      const dx = x - ripple.x;
      const dy = y - ripple.y;
      if (!rippleMayReach(ripple, dx, dy)) continue;
      const distance = Math.hypot(dx, dy);
      const difference = distance - ripple.radius;
      if (difference < -RIPPLE_CUT || difference > RIPPLE_CUT) continue;
      const envelope = Math.exp(-(difference ** 2) / (2 * WAVE_BAND ** 2)) * ripple.amplitude;
      const strength = Math.sin(difference * WAVE_K) * envelope;
      brightness += strength;
      if (distance > 0.001) {
        offsetX += (dx / distance) * strength;
        offsetY += (dy / distance) * strength;
      }
    }
    rippleSample.b = brightness;
    rippleSample.ox = offsetX;
    rippleSample.oy = offsetY;
    return rippleSample;
  }

  function draw(now) {
    if (!field || !nav) return null;
    const motion = updateAsciiMotion(now, start, reducedMotion);
    const { t, breath, scanNorm, driftX, driftY } = motion;
    const width = cssWidth;
    const height = cssHeight;
    const scanY = scanNorm * rows;
    const waveTime = t * 1.6;
    const waveTimeSin = Math.sin(waveTime);
    const waveTimeCos = Math.cos(waveTime);
    updateRipples((now - start) / 1000);

    hitBoxes = embeddedNav
      ? buildNavHitBoxes(nav.regions, cellW, cellH, motion, reducedMotion, viewportHeight)
      : [];
    const hit = pointer.active ? hitTestAsciiNav(hitBoxes, pointer.x, pointer.y) : null;
    hoveredId = hit ? hit.id : -999;
    cursor = hit ? 'pointer' : 'crosshair';

    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.font = FONT;
    context.textBaseline = 'top';

    const hoveredRegion = nav.regions.find((region) => region.id === hoveredId);
    const hasRipples = ripples.length > 0;
    const pointerLive = pointer.active && !hit;
    const pointerX = pointer.x;
    const pointerY = pointer.y;
    for (let y = 0; y < rows; y += 1) {
      const rowIndex = y * cols;
      const band = Math.max(0, 1 - Math.abs(y - scanY) / 6);
      const py = centerY[y];
      const rowY = y * cellH;
      const bandDriftX = driftX * (0.15 + band * 0.35);
      const bandDriftY = driftY * (0.1 + band * 0.25);
      const bandBrightness = band * 0.07;
      const inHoverRow = hoveredRegion && y >= hoveredRegion.minY && y <= hoveredRegion.maxY;
      const onHoverEdgeRow = inHoverRow
        && (y === hoveredRegion.minY || y === hoveredRegion.maxY);
      const dy = py - pointerY;
      const dySq = dy * dy;
      for (let x = 0; x < cols; x += 1) {
        const index = rowIndex + x;
        const wave = (waveSin[index] * waveTimeCos + waveCos[index] * waveTimeSin) * 0.03;
        const px = centerX[x];
        const ripple = hasRipples ? sampleRipple(px, py) : null;
        const inHover = inHoverRow && x >= hoveredRegion.minX && x <= hoveredRegion.maxX;

        let brightness = field[index] + breath + wave + bandBrightness
          + (ripple ? ripple.b * 0.2 : 0);
        if (inHover) {
          const edge = onHoverEdgeRow || x === hoveredRegion.minX || x === hoveredRegion.maxX;
          brightness = edge ? 0.05 : 0.92;
        } else if (embeddedNav && nav.halo[index] > 0.2) {
          brightness = Math.max(brightness, 0.96);
        }
        brightness = Math.min(1, Math.max(0, brightness));

        // Squared distance only gates the call; the ramp choice still uses the
        // same hypot the original did, so glyphs pick identically.
        const dx = px - pointerX;
        const nearPointer = pointerLive && dx * dx + dySq < NEAR_POINTER_SQ
          && Math.hypot(dx, dy) < NEAR_POINTER;
        const glyph = charFromRamp(nearPointer ? FINE_RAMP : COARSE_RAMP, brightness);
        // A blank ramp step paints nothing, so the whole cell can be skipped.
        if (glyph === ' ') continue;
        const offsetX = bandDriftX + (ripple ? ripple.ox * cellW * 0.8 : 0);
        const offsetY = bandDriftY + (ripple ? ripple.oy * cellH * 0.8 : 0);
        const fillStyle = duotoneColor(brightness);
        const alpha = nearPointer ? 0.88 : 0.58 + band * 0.2;
        glyphPainter.paint(glyph, fillStyle, alpha, x * cellW + offsetX, rowY + offsetY);
      }
    }

    glyphPainter.finish();
    if (embeddedNav) {
      drawAsciiNav(context, nav, {
        cellW,
        cellH,
        motion,
        reducedMotion,
        hoveredId,
        foreground,
        accent,
        rippleField: sampleRipple,
        viewportHeight,
      });
    }

    context.globalAlpha = 1;
    context.globalAlpha = 1;
    return { cursor, hitBoxes: hitBoxes.map(slimBox), motion };
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
      return context.getImageData(0, 0, canvas.width, canvas.height);
    },
  };
}
