/**
 * Particle Constellation System
 * Inspired by Google Antigravity's scattered dot animation.
 * Lightweight, requestAnimationFrame-based, mouse-interactive.
 */
(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "particle-canvas";
  canvas.style.cssText = [
    "position:fixed", "inset:0", "z-index:0", "pointer-events:none",
    "width:100%", "height:100%", "opacity:0.72"
  ].join(";");
  document.body.prepend(canvas);

  const ctx = canvas.getContext("2d");

  const COLORS = [
    "#FDE68A", "#F59E0B", "#D97706", "#B45309", /* Golds / Ambers */
    "#E2E8F0", "#F8FAFC", "#CBD5E1",             /* Silvers / Whites */
    "#8B5CF6", "#A78BFA"                          /* Subtle Purples */
  ];

  const PARTICLE_COUNT = 110;
  const MAX_RADIUS = 3.2;
  const MIN_RADIUS = 0.9;
  const MOUSE_REPEL_RADIUS = 130;
  const MOUSE_REPEL_STRENGTH = 0.018;
  const BASE_SPEED = 0.18;

  let W = 0, H = 0;
  let mouseX = -9999, mouseY = -9999;
  let particles = [];
  let raf;
  let paused = false;

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function createParticle(forcePos) {
    const r = rand(MIN_RADIUS, MAX_RADIUS);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const speed = rand(BASE_SPEED * 0.4, BASE_SPEED * 1.8);
    const angle = rand(0, Math.PI * 2);
    return {
      x: forcePos ? rand(0, W) : rand(-r * 2, W + r * 2),
      y: forcePos ? rand(0, H) : rand(-r * 2, H + r * 2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r,
      alpha: rand(0.35, 0.9),
      alphaDelta: rand(0.002, 0.006) * (Math.random() < 0.5 ? 1 : -1),
      alphaMin: rand(0.15, 0.35),
      alphaMax: rand(0.7, 0.95),
      color,
      shape: Math.random() < 0.25 ? "rect" : "circle",
      rectW: rand(2.5, 5.5),
      rectH: rand(1.5, 3.5),
      rotation: rand(0, Math.PI * 2),
      rotSpeed: rand(-0.015, 0.015),
    };
  }

  function resize() {
    W = canvas.offsetWidth;
    H = canvas.offsetHeight;
    canvas.width = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  function init() {
    resize();
    particles = Array.from({ length: PARTICLE_COUNT }, () => createParticle(true));
  }

  function drawParticle(p) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    if (p.shape === "rect") {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillRect(-p.rectW / 2, -p.rectH / 2, p.rectW, p.rectH);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function update(p) {
    // Mouse repulsion
    const dx = p.x - mouseX;
    const dy = p.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
      const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS;
      p.vx += (dx / dist) * force * MOUSE_REPEL_STRENGTH * 12;
      p.vy += (dy / dist) * force * MOUSE_REPEL_STRENGTH * 12;
    }

    // Dampen velocity (gentle drag)
    p.vx *= 0.987;
    p.vy *= 0.987;

    // Clamp velocity
    const maxSpeed = BASE_SPEED * 4;
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > maxSpeed) { p.vx = (p.vx / speed) * maxSpeed; p.vy = (p.vy / speed) * maxSpeed; }

    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.rotSpeed;

    // Pulse alpha
    p.alpha += p.alphaDelta;
    if (p.alpha > p.alphaMax) { p.alpha = p.alphaMax; p.alphaDelta *= -1; }
    if (p.alpha < p.alphaMin) { p.alpha = p.alphaMin; p.alphaDelta *= -1; }

    // Wrap around edges
    const margin = p.r + 8;
    if (p.x < -margin) p.x = W + margin;
    else if (p.x > W + margin) p.x = -margin;
    if (p.y < -margin) p.y = H + margin;
    else if (p.y > H + margin) p.y = -margin;
  }

  function loop() {
    if (paused) return;
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      update(p);
      drawParticle(p);
    }
    raf = requestAnimationFrame(loop);
  }

  // Pause on PDF tab (performance)
  const observer = new MutationObserver(() => {
    const isPdf = document.body.classList.contains("is-pdf-tab");
    if (isPdf && !paused) {
      paused = true;
      cancelAnimationFrame(raf);
    } else if (!isPdf && paused) {
      paused = false;
      raf = requestAnimationFrame(loop);
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // Mouse tracking
  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  document.addEventListener("mouseleave", () => { mouseX = -9999; mouseY = -9999; });

  // Resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); }, 180);
  });

  init();
  loop();
})();
