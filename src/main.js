import './style.css';
import { initAsciiPortrait } from './ascii-portrait.js';
import { initAsciiField } from './ascii-field.js';
import { initAsciiMedia } from './ascii-media.js';
import { asciiMotion } from './ascii-motion.js';
import {
  documentIsFullscreen,
  installFullscreenGuard,
  shouldFreezeFullscreenLayout,
  onFullscreenLayoutResume,
} from './fullscreen-guard.js';

function setupSidebarNav() {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.getElementById('site-sidebar');
  if (!toggle || !sidebar) return;

  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  toggle.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('nav-open'));
  });

  sidebar.querySelectorAll('.site-nav a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

function splitIntoGlyphs(el) {
  if (!el || el.dataset.asciiBound === '1') return;
  const text = el.textContent;
  el.textContent = '';
  [...text].forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'nav-glyph';
    span.textContent = ch === ' ' ? '\u00A0' : ch;
    span.dataset.i = String(i);
    el.appendChild(span);
  });
  el.dataset.asciiBound = '1';
}

function bindAsciiNav() {
  // On home, nav is carved into the ASCII canvas — skip HTML wave overlay.
  if (document.body.classList.contains('page-home')) return;

  const sidebar = document.getElementById('site-sidebar');
  if (!sidebar) return;

  sidebar.querySelectorAll('.site-nav a').forEach(splitIntoGlyphs);

  const mark = sidebar.querySelector('.site-mark-glyph');
  if (mark) splitIntoGlyphs(mark);

  const socials = [...sidebar.querySelectorAll('.sidebar-footer .social-links a')];
  socials.forEach((a, index) => {
    a.dataset.waveIndex = String(index);
  });

  const links = [...sidebar.querySelectorAll('.site-nav a')];

  function applyMotion(detail) {
    if (document.body.classList.contains('ascii-nav-embedded')) return;
    const motion = detail || asciiMotion;
    if (motion.reducedMotion) {
      sidebar.querySelectorAll('.nav-glyph').forEach((glyph) => {
        glyph.style.transform = '';
      });
      socials.forEach((a) => {
        a.style.transform = '';
      });
      return;
    }

    const { t, driftX, driftY, scanNorm } = motion;

    links.forEach((link, linkIndex) => {
      const settled = link.matches(':hover, :focus-visible, [aria-current="page"]');
      link.querySelectorAll('.nav-glyph').forEach((glyph) => {
        if (settled) {
          glyph.style.transform = 'translate(0px, 0px)';
          return;
        }
        const i = Number(glyph.dataset.i) || 0;
        const row = 4 + linkIndex * 2.2;
        const wave = Math.sin(i * 0.42 + row * 0.17 + t * 1.6) * 2.8;
        const band = Math.max(0, 1 - Math.abs(row - scanNorm * 18) / 5);
        const ox = driftX * (0.55 + band * 0.45);
        const oy = driftY * (0.4 + band * 0.35) + wave + band * 1.4;
        glyph.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;
      });
    });

    const markGlyphs = sidebar.querySelectorAll('.site-mark .nav-glyph');
    const markSettled = sidebar.querySelector('.site-mark')?.matches(':hover, :focus-visible');
    markGlyphs.forEach((glyph) => {
      if (markSettled) {
        glyph.style.transform = 'translate(0px, 0px)';
        return;
      }
      const i = Number(glyph.dataset.i) || 0;
      const wave = Math.sin(i * 0.5 + t * 1.6) * 2.2;
      glyph.style.transform = `translate(${(driftX * 0.5).toFixed(2)}px, ${(driftY * 0.45 + wave).toFixed(2)}px)`;
    });

    socials.forEach((a) => {
      if (a.matches(':hover, :focus-visible')) {
        a.style.transform = 'translate(0px, 0px)';
        return;
      }
      const i = Number(a.dataset.waveIndex) || 0;
      const wave = Math.sin(i * 0.9 + t * 1.6) * 2.4;
      const band = Math.max(0, 1 - Math.abs(16 - scanNorm * 18) / 5);
      a.style.transform = `translate(${(driftX * 0.45).toFixed(2)}px, ${(driftY * 0.4 + wave + band).toFixed(2)}px)`;
    });
  }

  window.addEventListener('ascii-frame', (e) => applyMotion(e.detail));
}

function ensureAsciiField() {
  if (document.body.classList.contains('page-home')) return Promise.resolve();

  let mount = document.getElementById('ascii-field');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'ascii-field';
    mount.className = 'ascii-field';
    document.body.prepend(mount);
  }
  return initAsciiField(mount);
}

function setupPageTransitions() {
  const navigate = (href) => {
    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin) {
      window.location.assign(destination.href);
      return;
    }
    document.body.classList.add('site-leaving');
    window.setTimeout(() => {
      window.location.assign(destination.href);
    }, 190);
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (
      destination.pathname === window.location.pathname
      && destination.search === window.location.search
      && destination.hash
    ) return;

    event.preventDefault();
    navigate(destination.href);
  });

  window.addEventListener('ascii-navigate', (event) => {
    if (event.detail?.href) navigate(event.detail.href);
  });

  window.addEventListener('pageshow', () => {
    document.body.classList.remove('site-leaving');
  });
}

function setupVideoAutoplay(selector) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const videos = [...document.querySelectorAll(selector)];
  if (!videos.length) return;

  // Select the mobile encode once. A responsive <source media> query can
  // change when fullscreen changes the viewport, which reloads the video and
  // closes native fullscreen mode.
  if (window.matchMedia('(max-width: 480px)').matches) {
    videos.forEach((video) => {
      let sourceChanged = false;
      video.querySelectorAll('source[data-mobile-src]').forEach((source) => {
        source.src = source.dataset.mobileSrc;
        sourceChanged = true;
      });
      if (sourceChanged) video.load();
    });
  }

  const visibility = new Map(videos.map((video) => [video, false]));
  const isFullscreen = (video) => {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (video.webkitDisplayingFullscreen) return true;
    if (fullscreenElement === video) return true;
    if (fullscreenElement?.contains(video)) return true;
    if (fullscreenElement && video.contains(fullscreenElement)) return true;
    try {
      if (video.matches(':fullscreen')) return true;
    } catch {
      // ignore
    }
    try {
      if (video.matches(':-webkit-full-screen')) return true;
    } catch {
      // ignore
    }
    return false;
  };
  let activeVideo = null;

  // Only start playback. Never pause a sibling video from the observer —
  // pause() during Chrome's fullscreen enter race aborts native fullscreen.
  const startPlayback = (video) => {
    if (shouldFreezeFullscreenLayout() || isFullscreen(video) || documentIsFullscreen()) {
      activeVideo = video;
      return;
    }
    activeVideo = video;
    if (!reducedMotion && video.paused) video.play().catch(() => {});
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      visibility.set(video, entry.isIntersecting);
      if (entry.isIntersecting) startPlayback(video);
    });
  }, { threshold: 0.25 });

  const finishFullscreen = () => {
    if (shouldFreezeFullscreenLayout() || documentIsFullscreen()) return;
    videos.forEach((video) => {
      if (!visibility.get(video) && !isFullscreen(video) && !video.paused) {
        video.pause();
      }
    });
  };
  document.addEventListener('fullscreenchange', finishFullscreen);
  document.addEventListener('webkitfullscreenchange', finishFullscreen);

  videos.forEach((video) => {
    observer.observe(video);
    video.addEventListener('webkitbeginfullscreen', () => {
      activeVideo = video;
    });
    video.addEventListener('webkitendfullscreen', () => {
      window.setTimeout(finishFullscreen, 0);
    });
  });
}

function setupYouTubeFacades() {
  document.querySelectorAll('[data-youtube-id]').forEach((facade) => {
    const button = facade.querySelector('button');
    if (!button) return;

    button.addEventListener('click', () => {
      const videoId = facade.dataset.youtubeId;
      const title = facade.dataset.youtubeTitle || 'YouTube video';
      if (!videoId) return;

      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;
      iframe.title = title;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      facade.replaceChildren(iframe);
    }, { once: true });
  });
}

function setupSectionRail() {
  const sections = [...document.querySelectorAll('[data-section-label][id]')];
  const siteContent = document.querySelector('.site-content');
  if (sections.length < 2 || !siteContent) return;

  const pageName = document.querySelector('.page')?.dataset.page || 'Page';
  const rail = document.createElement('nav');
  rail.className = 'section-rail';
  rail.setAttribute('aria-label', `${pageName} sections`);
  rail.dataset.current = sections[0].dataset.sectionLabel;

  const track = document.createElement('div');
  track.className = 'section-rail-track';
  rail.appendChild(track);

  const markers = [];
  const links = sections.map((section, index) => {
    const link = document.createElement('a');
    link.className = 'section-rail-link';
    link.href = `#${section.id}`;
    link.style.setProperty('--section-index', String(index));

    const marker = document.createElement('span');
    marker.className = 'section-rail-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = '◇';
    markers.push(marker);

    const label = document.createElement('span');
    label.className = 'section-rail-label';
    label.textContent = section.dataset.sectionLabel;

    link.append(marker, label);
    track.appendChild(link);
    return link;
  });

  siteContent.prepend(rail);

  let frameRequested = false;
  const sectionTops = new Float64Array(sections.length);
  // Cached so the scroll handler never reads scrollHeight, which would force a
  // synchronous layout on every frame of every scroll. relayout() refreshes it
  // whenever the document can actually have changed height.
  let maxScroll = 1;
  let lastActiveIndex = -1;
  let lastProgress = '';

  const updateLayout = () => {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    sections.forEach((section, index) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      sectionTops[index] = top;
      const position = Math.min(1, Math.max(0, top / maxScroll));
      links[index].style.setProperty('--section-position', position.toFixed(4));
    });
  };

  const updateRail = () => {
    frameRequested = false;
    if (shouldFreezeFullscreenLayout()) return;
    const scrollY = window.scrollY;
    const progress = Math.min(1, Math.max(0, scrollY / maxScroll)).toFixed(4);
    if (progress !== lastProgress) {
      lastProgress = progress;
      rail.style.setProperty('--scroll-progress', progress);
    }

    const readingLine = scrollY + window.innerHeight * 0.38;
    let activeIndex = 0;
    for (let index = 0; index < sectionTops.length; index += 1) {
      if (sectionTops[index] <= readingLine) activeIndex = index;
    }

    // Rewriting class, text and attributes every frame invalidates style for
    // the whole rail; the active section only changes on section boundaries.
    if (activeIndex === lastActiveIndex) return;
    if (lastActiveIndex >= 0) {
      links[lastActiveIndex].classList.remove('is-active');
      links[lastActiveIndex].removeAttribute('aria-current');
      markers[lastActiveIndex].textContent = '◇';
    }
    lastActiveIndex = activeIndex;
    links[activeIndex].classList.add('is-active');
    links[activeIndex].setAttribute('aria-current', 'location');
    markers[activeIndex].textContent = '◆';
    rail.dataset.current = sections[activeIndex].dataset.sectionLabel;
  };

  const requestUpdate = () => {
    if (frameRequested || shouldFreezeFullscreenLayout()) return;
    frameRequested = true;
    requestAnimationFrame(updateRail);
  };

  const relayout = () => {
    if (shouldFreezeFullscreenLayout()) return;
    updateLayout();
    requestUpdate();
  };

  const resumeRail = () => {
    if (shouldFreezeFullscreenLayout()) return;
    updateLayout();
    requestUpdate();
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', relayout, { passive: true });
  window.addEventListener('load', relayout, { once: true });
  document.addEventListener('fullscreenchange', () => {
    if (!documentIsFullscreen()) resumeRail();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    if (!documentIsFullscreen()) resumeRail();
  });
  onFullscreenLayoutResume(resumeRail);
  document.fonts.ready.then(relayout).catch(() => {});

  document.querySelectorAll('img, video').forEach((media) => {
    if (media.complete || media.readyState >= 1) return;
    media.addEventListener(media.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', relayout, { once: true });
  });

  if ('ResizeObserver' in window) {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const resizeObserver = new ResizeObserver(() => {
        if (shouldFreezeFullscreenLayout()) return;
        relayout();
      });
      resizeObserver.observe(mainEl);
    }
  }

  relayout();
}

installFullscreenGuard();
setupSidebarNav();
setupPageTransitions();
setupVideoAutoplay('[data-autoplay-video]');
setupYouTubeFacades();
setupSectionRail();

const asciiMount = document.getElementById('ascii-portrait');
const portraitReady = asciiMount ? initAsciiPortrait(asciiMount) : Promise.resolve();
const fieldReady = ensureAsciiField();

bindAsciiNav();
initAsciiMedia();

const coreReady = Promise.allSettled([portraitReady, fieldReady]);
const readinessTimeout = new Promise((resolve) => {
  window.setTimeout(resolve, 550);
});

Promise.race([coreReady, readinessTimeout]).then(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('site-ready');
    });
  });
});
