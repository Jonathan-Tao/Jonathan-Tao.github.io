// Run against a local dev server or production preview:
// npm run check:performance -- http://127.0.0.1:3000 [baseline-url]
// Set CHROMIUM_PATH if using an existing Chromium installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const currentUrl = process.argv[2] || 'http://127.0.0.1:3000';
const baselineUrl = process.argv[3];
const routes = ['/', '/projects.html', '/experience.html', '/contact.html'];
const painterSource = fs.readFileSync(path.join(__dirname, '../ascii-glyph-painter.js'), 'utf8');

async function checkTextRendering(page) {
  const result = await page.evaluate((source) => {
    const makePainter = new Function(`${source.replace('export function', 'function')}; return createGlyphPainter;`)();
    let draws = 0;
    let originalDraws = 0;
    for (const [dpr, fallback] of [[1, false], [1.25, false], [2, false], [2, true]]) {
      const canvases = [document.createElement('canvas'), document.createElement('canvas')];
      canvases.forEach((c) => { c.width = 700 * dpr; c.height = 100 * dpr; });
      const [original, batched] = canvases.map((c) => c.getContext('2d'));
      for (const ctx of [original, batched]) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = '11px "Share Tech Mono", "Courier New", monospace';
        ctx.textBaseline = 'top';
      }
      const nativeDraw = batched.fillText.bind(batched);
      batched.fillText = (...args) => { draws++; nativeDraw(...args); };
      const renderingContext = fallback ? new Proxy(batched, {
        has(target, key) { return key !== 'letterSpacing' && key in target; },
        get(target, key) { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) { target[key] = value; return true; },
      }) : batched;
      const painter = makePainter(renderingContext, original.font, 7.8);
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 80; x++) {
          const glyph = ' .:-=+*#%@XYZ'[x % 13];
          if (glyph === ' ') continue;
          const color = x < 40 ? '#602c34' : '#b25c2e';
          const alpha = y % 2 ? 0.88 : 0.63;
          const px = x * 7.8 + (y === 3 ? Math.sin(x) : 0.22);
          const py = y * 12.5 + (y === 4 ? Math.cos(x) : 0.38);
          original.fillStyle = color;
          original.globalAlpha = alpha;
          original.fillText(glyph, px, py);
          originalDraws++;
          painter.paint(glyph, color, alpha, px, py);
        }
      }
      painter.finish();
      const a = original.getImageData(0, 0, canvases[0].width, canvases[0].height).data;
      const b = batched.getImageData(0, 0, canvases[1].width, canvases[1].height).data;
      // Browser text runs can round antialiased edges by one channel value.
      let max = 0;
      for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
      if (max > 2) throw new Error(`Text rendering differs at DPR ${dpr}: ${max}`);
    }
    return { draws, originalDraws };
  }, painterSource);
  assert(result.draws < result.originalDraws, 'Expected fewer text draw calls');
  console.log('Text rendering and batching:', result);
}

async function freeze(page) {
  await page.addInitScript(() => {
    let clock = 0;
    let next = 1;
    const callbacks = new Map();
    performance.now = () => clock;
    window.requestAnimationFrame = (cb) => { const id = next++; callbacks.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => callbacks.delete(id);
    window.tick = (time) => {
      clock = time;
      const batch = [...callbacks.values()];
      callbacks.clear();
      batch.forEach((cb) => cb(time));
    };
  });
}

async function compareCanvases(browser, options, route) {
  const pages = [];
  try {
    for (const base of [baselineUrl, currentUrl]) {
      const page = await browser.newPage(options);
      pages.push(page);
      await freeze(page);
      await page.goto(new URL(route, base).href);
      await page.waitForTimeout(800);
      await page.mouse.move(-100, -100);
    }
    const positions = [null, [options.viewport.width * 0.8, options.viewport.height * 0.65]];
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index];
      if (position) {
        for (const page of pages) {
          await page.mouse.move(...position);
          await page.mouse.down();
          await page.mouse.up();
        }
      }
      for (const time of [1000, 1500, 2000].map((t) => t + index * 3000)) {
        for (const page of pages) await page.evaluate((t) => window.tick(t), time);
        const frames = [];
        for (const page of pages) {
          frames.push(await page.evaluate(() => [...document.querySelectorAll('canvas')].map((canvas) => canvas.toDataURL())));
        }
        assert.deepEqual(frames[1], frames[0], `Canvas regression: ${route}, ${options.viewport.width}px, ${time}ms, ${position}`);
      }
    }
  } finally {
    for (const page of pages) await page.close();
  }
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const options of [
      { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    ]) {
      for (const route of routes) {
        const page = await browser.newPage(options);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        await page.addInitScript(() => {
          window.frameDurations = [];
          window.readyTime = 0;
          new MutationObserver(() => {
            if (!window.readyTime && document.body?.classList.contains('site-ready')) window.readyTime = performance.now();
          }).observe(document, { subtree: true, attributes: true });
          const raf = window.requestAnimationFrame;
          window.requestAnimationFrame = (cb) => raf.call(window, (time) => {
            const start = performance.now();
            cb(time);
            window.frameDurations.push(performance.now() - start);
          });
        });
        await page.goto(new URL(route, currentUrl).href);
        await page.waitForSelector('body.site-ready');
        await page.evaluate(() => document.fonts.ready);
        if (route === '/' && options.deviceScaleFactor === 1) await checkTextRendering(page);
        if (options.viewport.width === 390
          && !await page.locator('body').evaluate((body) => body.classList.contains('ascii-nav-embedded'))
          && await page.locator('.sidebar-toggle').isVisible()) {
          const toggle = page.locator('.sidebar-toggle');
          await toggle.click();
          await page.waitForSelector('body.nav-open');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Escape');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        }
        // Exercise lazy assets and section navigation throughout the page.
        await page.evaluate(async () => {
          for (const section of document.querySelectorAll('[data-section-label]')) {
            window.scrollTo({ top: section.offsetTop, behavior: 'instant' });
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          window.scrollTo({ top: 0, behavior: 'instant' });
          window.frameDurations = [];
        });
        await page.waitForTimeout(1200);
        const metrics = await page.evaluate(() => {
          const times = window.frameDurations.filter((t) => t > 1).sort((a, b) => a - b);
          return { readyMs: Math.round(window.readyTime), p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)] };
        });
        assert.deepEqual(errors, [], route);
        console.log(options.viewport.width, route, metrics);
        await page.close();
        if (baselineUrl) await compareCanvases(browser, options, route);
      }
    }
    for (const width of [1440, 390]) {
      const navPage = await browser.newPage({ viewport: { width, height: 900 } });
      await navPage.goto(new URL('/', currentUrl).href);
      await navPage.waitForSelector('body.site-ready');
      await navPage.mouse.move(width <= 600 ? 70 : width * 0.18 + 40, 103);
      await navPage.waitForTimeout(80);
      await navPage.mouse.click(width <= 600 ? 70 : width * 0.18 + 40, 103);
      await navPage.waitForURL('**/projects.html', { timeout: 5000 });
      await navPage.close();
    }
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.goto(new URL('/', currentUrl).href);
    await page.waitForSelector('body.site-ready');
    const first = await page.locator('canvas').evaluate((canvas) => canvas.toDataURL());
    await page.waitForTimeout(300);
    assert.equal(await page.locator('canvas').evaluate((canvas) => canvas.toDataURL()), first, 'Reduced motion must remain static');
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('canvas').evaluate((canvas) => canvas.width), 800, 'Reduced-motion portrait must repaint on resize');
    await page.close();
    console.log('Performance and interaction checks passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
