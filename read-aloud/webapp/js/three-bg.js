/**
 * three-bg.js
 * Premium 3D WebGL Background using Three.js
 * Creates a slow-moving, elegant field of glowing particles/fireflies
 * that react slightly to mouse movement.
 */

let scene, camera, renderer, particles;
let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;

const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;

export function initThreeBackground() {
  const canvas = document.getElementById('three-canvas');
  if (!canvas || !window.THREE) return;

  // Fade canvas in
  setTimeout(() => {
    canvas.style.opacity = '1';
  }, 100);

  // 1. Setup Scene & Camera
  scene = new THREE.Scene();
  // We'll leave the scene background transparent so CSS themes show through
  
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 2000);
  camera.position.z = 1000;

  // 2. Setup Renderer
  renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  // 3. Create Magical Particles
  const geometry = new THREE.BufferGeometry();
  const particleCount = 600; // Elegant, not too crowded
  
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  const color1 = new THREE.Color(0x8b5cf6); // Purple
  const color2 = new THREE.Color(0xf59e0b); // Gold/Orange
  const color3 = new THREE.Color(0x34d399); // Mint

  for (let i = 0; i < particleCount; i++) {
    // Random positions spread over a large area
    positions[i * 3] = (Math.random() - 0.5) * 3000;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 3000;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2000;

    // Mix colors randomly
    const mixColor = new THREE.Color();
    const rand = Math.random();
    if (rand < 0.33) {
      mixColor.copy(color1);
    } else if (rand < 0.66) {
      mixColor.copy(color2);
    } else {
      mixColor.copy(color3);
    }
    
    // Add slight random variation to color
    mixColor.offsetHSL(Math.random() * 0.1 - 0.05, 0, Math.random() * 0.2 - 0.1);

    colors[i * 3] = mixColor.r;
    colors[i * 3 + 1] = mixColor.g;
    colors[i * 3 + 2] = mixColor.b;

    // Randomize sizes for depth
    sizes[i] = Math.random() * 4 + 1;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Custom shader material for soft glowing circles instead of sharp squares
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // Size attenuates with distance
        gl_PointSize = size * (1000.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        // Create soft circle
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        // Soft edge fade
        float alpha = (0.5 - dist) * 2.0;
        gl_FragColor = vec4(vColor, alpha * 0.6);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending // Normal blending looks good on both light and dark themes
  });

  particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // 4. Mouse interaction
  document.addEventListener('mousemove', onDocumentMouseMove, false);
  window.addEventListener('resize', onWindowResize, false);

  // 5. Start animation loop
  animate();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onDocumentMouseMove(event) {
  mouseX = event.clientX - windowHalfX;
  mouseY = event.clientY - windowHalfY;
}

function animate() {
  requestAnimationFrame(animate);
  render();
}

function render() {
  // Smooth mouse follow
  targetX = mouseX * 0.2;
  targetY = mouseY * 0.2;

  camera.position.x += (targetX - camera.position.x) * 0.02;
  camera.position.y += (-targetY - camera.position.y) * 0.02;
  camera.lookAt(scene.position);

  // Slow continuous rotation of the particle field
  const time = Date.now() * 0.00005;
  particles.rotation.y = time;
  particles.rotation.x = time * 0.5;

  renderer.render(scene, camera);
}
