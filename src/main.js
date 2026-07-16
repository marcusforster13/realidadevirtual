import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// Céu realista (procedural, com sol) - dia claro
const sky = new Sky();
sky.scale.setScalar(4500);
scene.add(sky);

const sunPosition = new THREE.Vector3();
const phi = THREE.MathUtils.degToRad(20);
const theta = THREE.MathUtils.degToRad(180);
sunPosition.setFromSphericalCoords(1, phi, theta);

sky.material.uniforms.sunPosition.value = sunPosition;
sky.material.uniforms.turbidity.value = 5;
sky.material.uniforms.rayleigh.value = 2;
sky.material.uniforms.mieCoefficient.value = 0.005;
sky.material.uniforms.mieDirectionalG.value = 0.8;

// Reflexo do ambiente (baseado no céu)
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(sky).texture;
scene.environmentIntensity = 0.3;

// Luz do sol (com sombras ativadas)
const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);
sunLight.position.copy(sunPosition).multiplyScalar(100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -50;
sunLight.shadow.camera.right = 50;
sunLight.shadow.camera.top = 50;
sunLight.shadow.camera.bottom = -50;
scene.add(sunLight);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.2));

// Chão
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({ color: 0x333333 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Jogador (grupo que contém câmera e controles - mover ele é andar/voar)
const player = new THREE.Group();
player.add(camera);
scene.add(player);
player.position.set(0, 0, 3);

// Carregando o modelo principal (casa)
const loader = new GLTFLoader();
loader.load(
  '/UFA3.glb',
  (gltf) => {
    const model = gltf.scene;
    model.position.set(0, 0, -3);
    model.scale.set(1, 1, 1);

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    scene.add(model);

    // Busca o ponto de spawn dentro do modelo carregado
    const spawnPoint = model.getObjectByName('SpawnPoint');
    if (spawnPoint) {
      const worldPosition = new THREE.Vector3();
      spawnPoint.getWorldPosition(worldPosition);
      player.position.copy(worldPosition);
      console.log('SpawnPoint encontrado! Jogador posicionado em:', worldPosition);
    } else {
      console.warn('SpawnPoint não encontrado no modelo - usando posição padrão');
    }

    console.log('Modelo carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o modelo:', error);
  }
);

// ===== ALVO (mantém a posição exportada do Blender) =====
let alvoObjeto = null;
let alvoVisivel = true;

loader.load(
  '/alvo.glb',
  (gltf) => {
    alvoObjeto = gltf.scene;
    alvoObjeto.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(alvoObjeto);
    console.log('Alvo carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o alvo:', error);
  }
);

// Som de acerto (gerado por código, sem precisar de arquivo)
function tocarSomDeAcerto() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.15);

  gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.15);
}

// Faz o alvo sumir e reaparecer depois de 15 segundos
function acertarAlvo() {
  if (!alvoObjeto || !alvoVisivel) return;

  alvoVisivel = false;
  alvoObjeto.visible = false;
  tocarSomDeAcerto();

  setTimeout(() => {
    alvoObjeto.visible = true;
    alvoVisivel = true;
  }, 15000);
}

// ===== SISTEMA DE MIRA/TIRO (raycasting) =====
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

function verificarTiro(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  if (alvoObjeto && alvoVisivel) {
    const intersects = raycaster.intersectObject(alvoObjeto, true);
    if (intersects.length > 0) {
      acertarAlvo();
    }
  }
}

// ===== LASER VISUAL (linha vermelha saindo do controle) =====
function criarLaser() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -5),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
  const laser = new THREE.Line(geometry, material);
  laser.name = 'laser';
  return laser;
}

// Configurando os dois controles (dentro do player, pra seguir o movimento ao andar/voar)
const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);

controller0.add(criarLaser());
controller1.add(criarLaser());

player.add(controller0);
player.add(controller1);

controller0.addEventListener('selectstart', () => verificarTiro(controller0));
controller1.addEventListener('selectstart', () => verificarTiro(controller1));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Movimento: joystick esquerdo anda, Y sobe, X desce (botões do controle esquerdo)
function handleControllerMovement() {
  const session = renderer.xr.getSession();
  if (!session) return;

  const speed = 0.15;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;
    const axes = source.gamepad.axes;
    const buttons = source.gamepad.buttons;
    const x = axes[2] || 0;
    const y = axes[3] || 0;

    if (source.handedness === 'left') {
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      direction.y = 0;
      direction.normalize();

      const sideways = new THREE.Vector3();
      sideways.crossVectors(camera.up, direction).normalize();

      player.position.addScaledVector(direction, -y * speed);
      player.position.addScaledVector(sideways, -x * speed);

      const buttonX = buttons[4]?.pressed;
      const buttonY = buttons[5]?.pressed;

      if (buttonY) player.position.y += speed;
      if (buttonX) player.position.y -= speed;
    }
  }
}

renderer.setAnimationLoop(() => {
  handleControllerMovement();
  renderer.render(scene, camera);
});
