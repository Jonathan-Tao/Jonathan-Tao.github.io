import './style.css';

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

setupVideoAutoplay('#corexy-video');
setupVideoAutoplay('#wander-video');
setupVideoAutoplay('.gallery-video');

function setupGalleryMarquees() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('.gallery-marquee').forEach((marquee) => {
    const track = marquee.querySelector('.gallery-marquee-track');
    if (!track) return;

    if (!track.dataset.marqueeOriginalHtml) {
      track.dataset.marqueeOriginalHtml = track.innerHTML.trim();
    } else {
      track.innerHTML = track.dataset.marqueeOriginalHtml;
    }

    const originals = [...track.children];
    if (originals.length === 0) return;

    const targetWidth = () => Math.max(marquee.clientWidth * 2, 1);
    let guard = 0;

    while (track.scrollWidth < targetWidth() && guard < 24) {
      originals.forEach((card) => {
        track.appendChild(card.cloneNode(true));
      });
      guard += 1;
    }

    [...track.children].forEach((card) => {
      track.appendChild(card.cloneNode(true));
    });

    if (reducedMotion) {
      track.style.animation = 'none';
      return;
    }

    track.style.animation = '';
    const speed = marquee.dataset.marqueeSpeed || '40';
    track.style.setProperty('--marquee-duration', `${speed}s`);
  });
}

function initGalleryMarquees() {
  setupGalleryMarquees();
  requestAnimationFrame(setupGalleryMarquees);
}

if (document.readyState === 'complete') {
  initGalleryMarquees();
} else {
  window.addEventListener('load', initGalleryMarquees);
}

let marqueeResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(marqueeResizeTimer);
  marqueeResizeTimer = setTimeout(setupGalleryMarquees, 200);
});
