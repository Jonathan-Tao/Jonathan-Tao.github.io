// Runs an ASCII renderer core against a transferred OffscreenCanvas so the
// per-frame text drawing stays off the main thread. The page still owns the
// clock: it sends every frame's timestamp, so motion matches the main-thread
// renderer exactly. Messages are handled strictly in arrival order.
import { createPortraitCore } from './portrait-core.js';
import { createFieldCore } from './field-core.js';

const CORES = { portrait: createPortraitCore, field: createFieldCore };
let core = null;
let queue = Promise.resolve();

async function init(data) {
  // Canvas text resolves fonts through the worker's own FontFaceSet, so the
  // page's @font-face has to be registered here too (same files, same order).
  if (!self.fonts || typeof FontFace === 'undefined') throw new Error('No worker fonts');
  const face = new FontFace(
    'Share Tech Mono',
    `url(${data.fontUrls[0]}) format('woff2'), url(${data.fontUrls[1]}) format('truetype')`,
    { style: 'normal', weight: '400' },
  );
  self.fonts.add(face);
  await face.load();
  core = CORES[data.kind](data.canvas, {
    image: data.image,
    reducedMotion: data.reducedMotion,
    start: data.start,
  });
}

function handle(data) {
  switch (data.type) {
    case 'init':
      return init(data).then(
        () => self.postMessage({ type: 'ready' }),
        (error) => self.postMessage({ type: 'failed', message: String(error) }),
      );
    case 'layout':
      self.postMessage({ type: 'layout', result: core.layout(data.env) });
      break;
    case 'viewport':
      core.setViewportHeight(data.height);
      break;
    case 'ripple':
      core.addRipple(data.ripple);
      break;
    case 'frame':
      if (data.pointer) core.setPointer(data.pointer);
      self.postMessage({ type: 'frame', result: core.draw(data.now) });
      break;
    case 'snapshot': {
      const image = core.snapshot();
      self.postMessage({ type: 'snapshot', image }, [image.data.buffer]);
      break;
    }
    default:
      break;
  }
  return undefined;
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};
