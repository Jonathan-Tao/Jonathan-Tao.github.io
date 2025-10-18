import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Setup

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.setZ(30);
camera.position.setX(-3);

renderer.render(scene, camera);

//cool shape math

const points = [];
for (let i = 0; i < 10; ++i) {
  points.push(new THREE.Vector2(Math.sin(i * 0.2) * 3 + 3, (i - 5) * .8));
}
const segments = 50;
const phiStart = Math.PI * 2.00;
const phiLength = Math.PI * 2.00;
const geometry = new THREE.LatheGeometry(
  points, segments, phiStart, phiLength);



const material = new THREE.MeshStandardMaterial({ color: 0xF347A });
const torus = new THREE.Mesh(geometry, material);

//scene.add(torus);

// Lights

const pointLight = new THREE.PointLight(0xffffff);
pointLight.position.set(5, 5, 5);

const ambientLight = new THREE.AmbientLight(0xffffff);
scene.add(pointLight, ambientLight);

// Helpers

// const lightHelper = new THREE.PointLightHelper(pointLight)
// const gridHelper = new THREE.GridHelper(200, 50);
// scene.add(lightHelper, gridHelper)

// const controls = new OrbitControls(camera, renderer.domElement);

function addStar() {
  const geometry = new THREE.SphereGeometry(0.25, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const star = new THREE.Mesh(geometry, material);

  const [x, y, z] = Array(3)
    .fill()
    .map(() => THREE.MathUtils.randFloatSpread(500));

  star.position.set(x, y, z);
  scene.add(star);
}

Array(1000).fill().forEach(addStar);

// Background

const backgroundTexture = new THREE.TextureLoader().load('/976156.png');
const backgroundGeometry = new THREE.SphereGeometry(500, 60, 40);
backgroundGeometry.scale(-1, 1, 1);
const backgroundMaterial = new THREE.MeshBasicMaterial({ map: backgroundTexture });
const backgroundSphere = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
scene.add(backgroundSphere);

// Avatar

const jeffTexture = new THREE.TextureLoader().load('/currentPhoto.JPG', function(texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const aspectRatio = texture.image.width / texture.image.height;
  if (aspectRatio > 1) {
    texture.repeat.set(1 / aspectRatio, 1);
    texture.offset.set((1 - (1 / aspectRatio)) / 2, 0);
  } else {
    texture.repeat.set(1, aspectRatio);
    texture.offset.set(0, (1 - aspectRatio) / 2);
  }
});

const jeff = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ map: jeffTexture }));

scene.add(jeff);

// Moon

const moonTexture = new THREE.TextureLoader().load('/8k_earth_daymap.jpg');

const moon = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 32), new THREE.MeshBasicMaterial({ map: moonTexture }));

scene.add(moon);

moon.position.z = -400;
moon.position.setX(-100);

// Letter I
const iGeometry = new THREE.BoxGeometry(0.75, 3, 0.5);
const iBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xFF5F05 }); // Illini Orange

const letterI = new THREE.Group();

const iBody = new THREE.Mesh(iGeometry, iBodyMaterial);
letterI.add(iBody);

const serifGeometry = new THREE.BoxGeometry(1.5, 0.5, 0.5);

const topSerif = new THREE.Mesh(serifGeometry, iBodyMaterial);
topSerif.position.y = 1.25;
letterI.add(topSerif);

const bottomSerif = new THREE.Mesh(serifGeometry, iBodyMaterial);
bottomSerif.position.y = -1.25;
letterI.add(bottomSerif);

scene.add(letterI);
letterI.position.set(2, 0, 5);

// Lightbulb

const lightbulbPivot = new THREE.Group();
scene.add(lightbulbPivot);

lightbulbPivot.position.set(-2, 0, 40);

const lightbulb = new THREE.Group();
lightbulbPivot.add(lightbulb);

const bulbGeometry = new THREE.SphereGeometry(1, 32, 32);
const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xF6F6DF, emissive: 0xF6F6DF, emissiveIntensity: 0.04 });
const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
lightbulb.add(bulb);

const baseGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
const base = new THREE.Mesh(baseGeometry, baseMaterial);
base.position.y = -1.5;
lightbulb.add(base);

// Integrated Circuit
const ic = new THREE.Group();

const icBodyGeometry = new THREE.BoxGeometry(6.35, 2, 20.32);
const icBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
const icBody = new THREE.Mesh(icBodyGeometry, icBodyMaterial);
ic.add(icBody);

const pinGeometry = new THREE.BoxGeometry(0.5, 1, 0.5);
const pinMaterial = new THREE.MeshStandardMaterial({ color: 0xFFD700 }); // Gold

const rowSpacing = 7.62;
const pinSpacing = 2.54;

for (let i = 0; i < 8; i++) {
  const pin1 = new THREE.Mesh(pinGeometry, pinMaterial);
  pin1.position.set(-rowSpacing / 2, -1.5, -20.32 / 2 + pinSpacing / 2 + i * pinSpacing);
  ic.add(pin1);

  const pin2 = new THREE.Mesh(pinGeometry, pinMaterial);
  pin2.position.set(rowSpacing / 2, -1.5, -20.32 / 2 + pinSpacing / 2 + i * pinSpacing);
  ic.add(pin2);
}

//scene.add(ic);
ic.position.set(3, 0, 11);

jeff.position.z = -5;
jeff.position.x = 2;

// Scroll Animation

function moveCamera() {
  const t = document.body.getBoundingClientRect().top;
  moon.rotation.x += 0.05;
  moon.rotation.y += 0.075;
  moon.rotation.z += 0.05;

  jeff.rotation.y += 0.01;
  jeff.rotation.z += 0.01;

  // Animate letter I
  letterI.rotation.y += 0.01;
  letterI.rotation.z += 0.01;

  // Animate Lightbulb
  lightbulb.rotation.y += 0.01;
  lightbulb.rotation.z += 0.01;

  camera.position.z = t * -0.01;
  camera.position.x = t * -0.0002;
  camera.rotation.y = t * -0.0002;

  
}

document.body.onscroll = moveCamera;
moveCamera();

// Animation Loop

function animate() {
  requestAnimationFrame(animate);

  backgroundSphere.rotation.y += 0.0001;

  torus.rotation.x += 0.001;
  torus.rotation.y += 0.0005;
  torus.rotation.z += 0.001;

  jeff.rotation.x += 0.001;
  jeff.rotation.y += 0.001;
  jeff.rotation.z += 0.001;

  letterI.rotation.x += 0.003;
  letterI.rotation.y += 0.003;
  letterI.rotation.z += 0.003;

  lightbulbPivot.rotation.x += 0.001;
  lightbulbPivot.rotation.y += 0.001;
  lightbulbPivot.rotation.z += 0.001;

  ic.rotation.x += 0.001;
  ic.rotation.y += 0.002;

  moon.rotation.x += 0.005;

  // controls.update();

  renderer.render(scene, camera);
}

animate();

// Video Autoplay on Scroll
function setupVideoAutoplay(videoId) {
  const video = document.getElementById(videoId);
  if (video) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (video.paused) {
            video.play().catch(error => {
              console.error(`Video play failed for ${videoId}:`, error);
            });
          }
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.25 }); // Trigger when 25% of the video is visible

    observer.observe(video);
  }
}

setupVideoAutoplay('corexy-video');
setupVideoAutoplay('wander-video');