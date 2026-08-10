// Chrome can fire resize / IntersectionObserver callbacks while native video
// fullscreen is still settling — before document.fullscreenElement is set.
// Layout thrash or pause() in that window aborts fullscreen shortly after enter.

let freezeUntil = 0;

function markVideoChrome(ms = 4000) {
  freezeUntil = Math.max(freezeUntil, performance.now() + ms);
}

function videoMatchesFullscreen(video) {
  try {
    if (video.matches(':fullscreen')) return true;
  } catch {
    // ignore unsupported selector
  }
  try {
    if (video.matches(':-webkit-full-screen')) return true;
  } catch {
    // ignore unsupported selector
  }
  return Boolean(video.webkitDisplayingFullscreen);
}

function anyVideoWebkitFullscreen() {
  return [...document.querySelectorAll('video')].some(videoMatchesFullscreen);
}

export function documentIsFullscreen() {
  return Boolean(
    document.fullscreenElement
    || document.webkitFullscreenElement
    || anyVideoWebkitFullscreen(),
  );
}

export function shouldFreezeFullscreenLayout() {
  if (documentIsFullscreen()) return true;
  if (performance.now() < freezeUntil) return true;
  if (document.activeElement?.tagName === 'VIDEO') return true;
  return false;
}

export function installFullscreenGuard() {
  const note = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const hitVideo = path.some((node) => node instanceof HTMLVideoElement)
      || event.target instanceof HTMLVideoElement;
    if (hitVideo) markVideoChrome();
  };

  // Capture early: native control clicks + fullscreen transitions + the resize
  // storm that accompanies Chrome's video fullscreen UI.
  document.addEventListener('pointerdown', note, true);
  document.addEventListener('touchstart', note, true);
  window.addEventListener('resize', () => {
    if (
      document.fullscreenElement
      || document.webkitFullscreenElement
      || document.activeElement?.tagName === 'VIDEO'
      || anyVideoWebkitFullscreen()
    ) {
      markVideoChrome();
    }
  }, true);
  document.addEventListener('fullscreenchange', () => {
    markVideoChrome(documentIsFullscreen() ? 4000 : 500);
  });
  document.addEventListener('webkitfullscreenchange', () => {
    markVideoChrome(documentIsFullscreen() ? 4000 : 500);
  });
}
