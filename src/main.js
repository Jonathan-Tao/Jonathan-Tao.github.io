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
    .map(() => THREE.MathUtils.randFloatSpread(100));

  star.position.set(x, y, z);
  scene.add(star);
}

Array(200).fill().forEach(addStar);

// Background

const spaceTexture = new THREE.TextureLoader().load('assets/background choise.jpg');
scene.background = spaceTexture;

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

lightbulbPivot.position.set(0, 0, 36);

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

  moon.rotation.x += 0.005;

  // controls.update();

  renderer.render(scene, camera);
}

animate();