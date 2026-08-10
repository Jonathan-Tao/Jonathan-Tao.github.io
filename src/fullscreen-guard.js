// Chrome/Firefox fire resize and IntersectionObserver during native video
// fullscreen transitions. Layout thrash in that window can disrupt fullscreen.
// Freeze only while actually fullscreen (plus a short exit settle), then resume.

let freezeUntil = 0;
let resumeTimer = 0;
const resumeListeners = new Set();

function scheduleResume() {
  clearTimeout(resumeTimer);
  // While fullscreen, wait for the exit handler instead of polling.
  if (documentIsFullscreen()) return;
  const delay = Math.max(0, freezeUntil - performance.now()) + 16;
  resumeTimer = window.setTimeout(() => {
    if (shouldFreezeFullscreenLayout()) {
      scheduleResume();
      return;
    }
    resumeListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore listener errors so one bad resume cannot block others
      }
    });
  }, delay);
}

function markVideoChrome(ms = 1200) {
  freezeUntil = Math.max(freezeUntil, performance.now() + ms);
  scheduleResume();
}

function clearVideoChromeSoon() {
  // Drop the long enter freeze; keep a brief settle for the exit resize storm.
  freezeUntil = performance.now() + 120;
  scheduleResume();
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
  return performance.now() < freezeUntil;
}

export function onFullscreenLayoutResume(listener) {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

export function installFullscreenGuard() {
  const note = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const hitVideo = path.some((node) => node instanceof HTMLVideoElement)
      || event.target instanceof HTMLVideoElement;
    if (hitVideo) markVideoChrome(1200);
  };

  document.addEventListener('pointerdown', note, true);
  document.addEventListener('touchstart', note, true);
  window.addEventListener('resize', () => {
    if (documentIsFullscreen()) markVideoChrome(1200);
  }, true);

  const onFullscreenChange = () => {
    if (documentIsFullscreen()) markVideoChrome(2000);
    else clearVideoChromeSoon();
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
}
