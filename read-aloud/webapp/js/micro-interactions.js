/**
 * micro-interactions.js
 * Handles premium interactive animations without touching app logic.
 * - 3D Tilt on library cards
 * - Ripple on button clicks
 * - TOC stagger indices
 * - Body playing state for waveform
 * - Status dot state management
 */

export function initMicroInteractions() {
  // ── 1. Library Card 3D Tilt & Spotlight ──
  initCardTilt();

  // ── 2. Ripple on all btn clicks ──
  initRipple();

  // ── 3. Observe playback state for waveform & play btn glow ──
  initPlayingStateObserver();

  // ── 4. Stagger TOC items when they appear ──
  initTocStagger();

  // ── 5. Book experience cinematic entrance ──
  initBookExperienceEntrance();
}

// ─────────────────────────────────────────────
// 3D Card Tilt
// ─────────────────────────────────────────────
function initCardTilt() {
  // Re-run whenever library grid updates
  const gridEl = document.getElementById('library-grid');
  if (!gridEl) return;

  const observer = new MutationObserver(() => applyTiltListeners());
  observer.observe(gridEl, { childList: true, subtree: true });
  applyTiltListeners();
}

function applyTiltListeners() {
  document.querySelectorAll('.library-card').forEach(card => {
    if (card.dataset.tiltBound) return;
    card.dataset.tiltBound = '1';

    card.addEventListener('mousemove', handleCardTilt);
    card.addEventListener('mouseleave', resetCardTilt);
  });
}

function handleCardTilt(e) {
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const rotX = ((y - cy) / cy) * -8; // max 8deg
  const rotY = ((x - cx) / cx) * 8;

  // Update spotlight position CSS vars
  const pctX = (x / rect.width) * 100;
  const pctY = (y / rect.height) * 100;
  card.style.setProperty('--mouse-x', `${pctX}%`);
  card.style.setProperty('--mouse-y', `${pctY}%`);

  card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px)`;
}

function resetCardTilt(e) {
  const card = e.currentTarget;
  card.style.transform = '';
  card.style.setProperty('--mouse-x', '50%');
  card.style.setProperty('--mouse-y', '50%');
}

// ─────────────────────────────────────────────
// Button Ripple
// ─────────────────────────────────────────────
function initRipple() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn, .transport-btn, .player-action-btn, .nav-btn');
    if (!btn) return;

    // Compute ripple position
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;

    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    ripple.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${x}px;
      top: ${y}px;
    `;

    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }, { passive: true });
}

// ─────────────────────────────────────────────
// Playing state observer — drives waveform + status dot
// ─────────────────────────────────────────────
function initPlayingStateObserver() {
  const statusEl = document.getElementById('playback-status');
  const dotEl = document.getElementById('status-dot');
  const playBtn = document.getElementById('play-button');
  const playBtn2 = document.getElementById('play-button-2');
  if (!statusEl) return;

  const updateState = () => {
    const status = statusEl.textContent?.trim().toLowerCase();
    const isPlaying = status === 'playing';
    const isPaused = status === 'paused';

    document.body.classList.toggle('is-playing', isPlaying);
    document.body.classList.toggle('is-paused', isPaused);

    if (dotEl) {
      dotEl.classList.toggle('is-playing', isPlaying);
    }
    if (playBtn) {
      playBtn.classList.toggle('is-playing', isPlaying);
    }
    if (playBtn2) {
      playBtn2.classList.toggle('is-playing', isPlaying);
    }
  };

  const obs = new MutationObserver(updateState);
  obs.observe(statusEl, { childList: true, characterData: true, subtree: true });
  updateState();
}

// ─────────────────────────────────────────────
// TOC stagger — add CSS custom property --i to each item
// ─────────────────────────────────────────────
function initTocStagger() {
  ['player-listen-toc-list', 'pdf-listen-toc-list'].forEach((id) => {
    const tocList = document.getElementById(id);
    if (!tocList) return;
    const observer = new MutationObserver(() => {
      tocList.querySelectorAll('.book-toc-item').forEach((item, i) => {
        item.style.setProperty('--i', String(i));
      });
    });
    observer.observe(tocList, { childList: true });
  });
}

// ─────────────────────────────────────────────
// Book experience entrance animation
// ─────────────────────────────────────────────
function initBookExperienceEntrance() {
  const el = document.getElementById('book-experience');
  if (!el) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      if (m.attributeName === 'hidden') {
        const hidden = el.hasAttribute('hidden');
        if (!hidden) {
          el.classList.remove('is-animating-in');
          void el.offsetWidth; // force reflow
          el.classList.add('is-animating-in');
        }
      }
    });
  });
  observer.observe(el, { attributes: true });
}
