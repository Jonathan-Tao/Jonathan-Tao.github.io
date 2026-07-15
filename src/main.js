import './style.css';
import { initAsciiPortrait } from './ascii-portrait.js';
import { initAsciiField } from './ascii-field.js';
import { initAsciiMedia } from './ascii-media.js';
import { asciiMotion } from './ascii-motion.js';

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
  document.querySelectorAll(selector).forEach((video) => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (video.paused) {
            video.play().catch(() => {});
          }
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.25 });

    observer.observe(video);
  });
}

setupSidebarNav();
setupPageTransitions();
setupVideoAutoplay('#corexy-video');
setupVideoAutoplay('#wander-video');

const asciiMount = document.getElementById('ascii-portrait');
const portraitReady = asciiMount ? initAsciiPortrait(asciiMount) : Promise.resolve();
const fieldReady = ensureAsciiField();

bindAsciiNav();
initAsciiMedia();

const coreReady = Promise.allSettled([portraitReady, fieldReady]);
const readinessTimeout = new Promise((resolve) => {
  window.setTimeout(resolve, 900);
});

Promise.race([coreReady, readinessTimeout]).then(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('site-ready');
    });
  });
});
