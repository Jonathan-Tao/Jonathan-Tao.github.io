// Drives an ASCII renderer core either in a worker (OffscreenCanvas) or, when
// that is unavailable, on the main thread. Both paths run the same drawing
// code with the same inputs, so they paint identical pixels. Results arrive
// through onLayout/onFrame: synchronously on the main thread, or when the
// worker replies. `?ascii-worker=0` forces the main-thread path.
import AsciiRenderWorker from './ascii-render-worker.js?worker';
import { createPortraitCore } from './portrait-core.js';
import { createFieldCore } from './field-core.js';

const CORES = { portrait: createPortraitCore, field: createFieldCore };
const FONT_URLS = ['/share-tech-mono.woff2', '/share-tech-mono.ttf'];

function workerRenderingAvailable() {
  if (new URLSearchParams(window.location.search).get('ascii-worker') === '0') return false;
  return typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
}

function createLocalRenderer(options) {
  const { kind, canvas, image, reducedMotion, start, onLayout, onFrame } = options;
  const core = CORES[kind](canvas, { image, reducedMotion, start });
  return {
    canvas,
    inWorker: false,
    busy: false,
    layout: (env) => onLayout(core.layout(env)),
    setViewportHeight: (height) => core.setViewportHeight(height),
    setPointer: (pointer) => core.setPointer(pointer),
    addRipple: (ripple) => core.addRipple(ripple),
    frame: (now) => onFrame(core.draw(now)),
    snapshot: async () => core.snapshot(),
  };
}

async function createWorkerRenderer(options) {
  const { kind, canvas, image, reducedMotion, start, onLayout, onFrame } = options;
  const bitmap = image ? await createImageBitmap(image) : null;
  const offscreen = canvas.transferControlToOffscreen();
  const worker = new AsciiRenderWorker();
  const snapshots = [];
  // Pointer moves can outnumber frames, and the core only reads the pointer
  // when it draws, so the latest one rides along with the next frame.
  let pendingPointer = null;
  let settle;
  const ready = new Promise((resolve) => {
    settle = resolve;
  });

  const renderer = {
    canvas,
    inWorker: true,
    busy: false,
    layout: (env) => worker.postMessage({ type: 'layout', env }),
    setViewportHeight: (height) => worker.postMessage({ type: 'viewport', height }),
    setPointer: (pointer) => {
      pendingPointer = pointer;
    },
    addRipple: (ripple) => worker.postMessage({ type: 'ripple', ripple }),
    // One frame in flight at a time: the host skips animation frames while
    // the worker is still drawing rather than queueing stale timestamps.
    frame: (now) => {
      renderer.busy = true;
      worker.postMessage({ type: 'frame', now, pointer: pendingPointer });
      pendingPointer = null;
    },
    snapshot: () => new Promise((resolve) => {
      snapshots.push(resolve);
      worker.postMessage({ type: 'snapshot' });
    }),
  };

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'ready':
        settle(true);
        break;
      case 'failed':
        settle(false);
        break;
      case 'layout':
        onLayout(data.result);
        break;
      case 'frame':
        renderer.busy = false;
        onFrame(data.result);
        break;
      case 'snapshot':
        snapshots.shift()(data.image);
        break;
      default:
        break;
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    settle(false);
  };

  const transfer = [offscreen];
  if (bitmap) transfer.push(bitmap);
  worker.postMessage({
    type: 'init',
    kind,
    canvas: offscreen,
    image: bitmap,
    reducedMotion,
    start,
    fontUrls: FONT_URLS.map((url) => new URL(url, window.location.href).href),
  }, transfer);

  if (await ready) return renderer;
  worker.terminate();
  return null;
}

export async function createAsciiRenderer(options) {
  let renderer = null;
  if (workerRenderingAvailable()) {
    try {
      renderer = await createWorkerRenderer(options);
    } catch {
      renderer = null;
    }
    if (!renderer && options.canvas.isConnected) {
      // A transferred canvas can never get a context again; swap in a fresh
      // element with the same attributes before drawing on the main thread.
      const fresh = options.canvas.cloneNode(false);
      options.canvas.replaceWith(fresh);
      options = { ...options, canvas: fresh };
    }
  }
  if (!renderer) renderer = createLocalRenderer(options);
  // Test hook: read back the rendered pixels whichever thread owns them.
  renderer.canvas.asciiSnapshot = () => renderer.snapshot();
  return renderer;
}
