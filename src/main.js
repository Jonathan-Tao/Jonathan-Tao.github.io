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

    const cards = [...track.children];
    cards.forEach((card) => track.appendChild(card.cloneNode(true)));

    if (reducedMotion) return;

    const speed = marquee.dataset.marqueeSpeed || '40';
    track.style.setProperty('--marquee-duration', `${speed}s`);
  });
}

setupGalleryMarquees();
