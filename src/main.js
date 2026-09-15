import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

const gravity = { x: 0.0, y: -9.81, z: 0.0 };
const physicsWorld = new RAPIER.World(gravity);

const chaoRigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.01, 0);
const chaoRigidBody = physicsWorld.createRigidBody(chaoRigidBodyDesc);
const chaoColliderDesc = RAPIER.ColliderDesc.cuboid(150, 0.01, 150);
physicsWorld.createCollider(chaoColliderDesc, chaoRigidBody);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  2000
);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

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

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(sky).texture;
scene.environmentIntensity = 0.3;

// --- Skybox de céu real (HDRI), só como fundo visual ---
// IMPORTANTE: isso NÃO mexe na iluminação da cena. O scene.environment
// (que ilumina/reflete nos materiais) continua vindo do Sky procedural
// acima, exatamente como já estava. Aqui só trocamos o que você VÊ no
// fundo, pela foto real do céu - a luz (sunLight, HemisphereLight, e o
// environment já calculado acima) fica 100% igual ao que já era.
const exrLoader = new EXRLoader();
exrLoader.load(
  '/evening_road_01_puresky_1k.exr',
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    // Esconde o céu procedural (Sky) pra não tampar o fundo novo - a luz
    // que ele já gerou pro scene.environment (linha acima) continua valendo,
    // porque já foi "fotografada" antes desse ponto.
    sky.visible = false;
    console.log('[DEBUG skybox] HDRI real carregado com sucesso - fundo trocado, luz mantida como estava.');
  },
  undefined,
  (erro) => {
    console.error('[DEBUG skybox] FALHOU ao carregar evening_road_01_puresky_1k.exr - confira se está na pasta raiz do projeto:', erro);
  }
);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);
sunLight.position.copy(sunPosition).multiplyScalar(100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -50;
sunLight.shadow.camera.right = 50;
sunLight.shadow.camera.top = 50;
sunLight.shadow.camera.bottom = -50;
scene.add(sunLight);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.2));

const player = new THREE.Group();
player.add(camera);
scene.add(player);
player.position.set(0, 0, 3);

const PLAYER_RAIO = 0.3;
const PLAYER_META_ALTURA = 0.6;
const PLAYER_OFFSET_BASE = PLAYER_META_ALTURA + PLAYER_RAIO;

const playerRigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
  player.position.x,
  player.position.y + PLAYER_OFFSET_BASE,
  player.position.z
);
const playerRigidBody = physicsWorld.createRigidBody(playerRigidBodyDesc);
const playerColliderDesc = RAPIER.ColliderDesc.capsule(PLAYER_META_ALTURA, PLAYER_RAIO);
const playerCollider = physicsWorld.createCollider(playerColliderDesc, playerRigidBody);

const characterController = physicsWorld.createCharacterController(0.02);
characterController.setSlideEnabled(true);

function definirPosicaoFisicaDoJogador(x, y, z) {
  player.position.set(x, y, z);
  playerRigidBody.setNextKinematicTranslation({ x, y: y + PLAYER_OFFSET_BASE, z });
}

function criarTexturaDeParticula() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,200,80,0.8)');
  gradient.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const FOGO_NUM_PARTICULAS = 110;
const FOGO_ALTURA_MAX = 1.4;
const FOGO_RAIO_BASE = 0.6;

const fogosAtivos = [];

function criarFogo(posicao) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(FOGO_NUM_PARTICULAS * 3);
  const velocidades = new Float32Array(FOGO_NUM_PARTICULAS);
  const offsetsX = new Float32Array(FOGO_NUM_PARTICULAS);
  const offsetsZ = new Float32Array(FOGO_NUM_PARTICULAS);

  for (let i = 0; i < FOGO_NUM_PARTICULAS; i++) {
    offsetsX[i] = (Math.random() - 0.5) * FOGO_RAIO_BASE;
    offsetsZ[i] = (Math.random() - 0.5) * FOGO_RAIO_BASE;
    velocidades[i] = 0.3 + Math.random() * 0.4;

    const alturaInicial = Math.random() * FOGO_ALTURA_MAX;
    positions[i * 3] = posicao.x + offsetsX[i];
    positions[i * 3 + 1] = posicao.y + alturaInicial;
    positions[i * 3 + 2] = posicao.z + offsetsZ[i];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    size: 0.25,
    map: criarTexturaDeParticula(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xffa040,
  });

  const particulas = new THREE.Points(geometry, material);
  scene.add(particulas);

  fogosAtivos.push({
    particulas,
    velocidades,
    offsetsX,
    offsetsZ,
    base: posicao.clone(),
  });
}

function atualizarFogo(delta) {
  fogosAtivos.forEach((fogo) => {
    const positions = fogo.particulas.geometry.attributes.position.array;
    const base = fogo.base;

    for (let i = 0; i < FOGO_NUM_PARTICULAS; i++) {
      positions[i * 3 + 1] += fogo.velocidades[i] * delta;

      if (positions[i * 3 + 1] - base.y > FOGO_ALTURA_MAX) {
        positions[i * 3] = base.x + fogo.offsetsX[i];
        positions[i * 3 + 1] = base.y;
        positions[i * 3 + 2] = base.z + fogo.offsetsZ[i];
      }
    }

    fogo.particulas.geometry.attributes.position.needsUpdate = true;
  });
}

// --- Fogos de artifício ---
// Diferente do criarFogo() (que fica queimando pra sempre), aqui cada
// "estouro" nasce, se espalha em todas as direções, cai com gravidade e
// desaparece sozinho depois de 1-2s - a partícula é destruída de vez
// (não fica acumulando memória rodando à toa).
const FOGOS_DE_ARTIFICIO_ATIVOS = [];
const FOGOS_ARTIFICIO_NUM_PARTICULAS = 80;
const FOGOS_ARTIFICIO_DURACAO_SEGUNDOS = 1.6;
const FOGOS_ARTIFICIO_VELOCIDADE_ESPALHAMENTO = 4.5;
const FOGOS_ARTIFICIO_GRAVIDADE = -3;
const FOGOS_ARTIFICIO_CORES = [0xff3b30, 0xffcc00, 0x34c759, 0x5ac8fa, 0xaf52de, 0xffffff];

function criarFogoDeArtificio(posicao) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(FOGOS_ARTIFICIO_NUM_PARTICULAS * 3);
  const velocidades = new Float32Array(FOGOS_ARTIFICIO_NUM_PARTICULAS * 3);

  for (let i = 0; i < FOGOS_ARTIFICIO_NUM_PARTICULAS; i++) {
    positions[i * 3] = posicao.x;
    positions[i * 3 + 1] = posicao.y;
    positions[i * 3 + 2] = posicao.z;

    // Direção aleatória numa esfera, pra "estourar" pra todos os lados.
    const direcao = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    const velocidade = direcao.multiplyScalar(FOGOS_ARTIFICIO_VELOCIDADE_ESPALHAMENTO * (0.5 + Math.random() * 0.5));

    velocidades[i * 3] = velocidade.x;
    velocidades[i * 3 + 1] = velocidade.y;
    velocidades[i * 3 + 2] = velocidade.z;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const cor = FOGOS_ARTIFICIO_CORES[Math.floor(Math.random() * FOGOS_ARTIFICIO_CORES.length)];
  const material = new THREE.PointsMaterial({
    color: cor,
    size: 0.08,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });

  const particulas = new THREE.Points(geometry, material);
  scene.add(particulas);

  FOGOS_DE_ARTIFICIO_ATIVOS.push({
    particulas,
    velocidades,
    tempoRestante: FOGOS_ARTIFICIO_DURACAO_SEGUNDOS,
  });
}

function atualizarFogosDeArtificio(delta) {
  for (let i = FOGOS_DE_ARTIFICIO_ATIVOS.length - 1; i >= 0; i--) {
    const fogo = FOGOS_DE_ARTIFICIO_ATIVOS[i];
    const positions = fogo.particulas.geometry.attributes.position.array;

    for (let j = 0; j < FOGOS_ARTIFICIO_NUM_PARTICULAS; j++) {
      fogo.velocidades[j * 3 + 1] += FOGOS_ARTIFICIO_GRAVIDADE * delta;
      positions[j * 3] += fogo.velocidades[j * 3] * delta;
      positions[j * 3 + 1] += fogo.velocidades[j * 3 + 1] * delta;
      positions[j * 3 + 2] += fogo.velocidades[j * 3 + 2] * delta;
    }
    fogo.particulas.geometry.attributes.position.needsUpdate = true;

    fogo.tempoRestante -= delta;
    // Some suavemente no último meio segundo.
    if (fogo.tempoRestante <= 0.5) {
      fogo.particulas.material.opacity = Math.max(0, fogo.tempoRestante / 0.5);
    }

    if (fogo.tempoRestante <= 0) {
      // Destrói de vez - geometria, material e o objeto da cena.
      scene.remove(fogo.particulas);
      fogo.particulas.geometry.dispose();
      fogo.particulas.material.dispose();
      FOGOS_DE_ARTIFICIO_ATIVOS.splice(i, 1);
    }
  }
}

// --- Efeito de sangue (respingo) ao acertar o bandido ---
// Mesma ideia dos fogos de artifício - partículas nascem, se espalham,
// caem com gravidade e desaparecem sozinhas. Só que aqui é vermelho, bem
// menor, mais rápido, e espalha na DIREÇÃO que o tiro veio (não em esfera
// completa), pra parecer um respingo de impacto de verdade.
const SANGUE_EFEITOS_ATIVOS = [];
const SANGUE_NUM_PARTICULAS = 18;
const SANGUE_DURACAO_SEGUNDOS = 0.6;
const SANGUE_VELOCIDADE_ESPALHAMENTO = 1.8;
const SANGUE_GRAVIDADE = -6;

function criarEfeitoDeSangue(posicao, direcaoTiro) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(SANGUE_NUM_PARTICULAS * 3);
  const velocidades = new Float32Array(SANGUE_NUM_PARTICULAS * 3);

  for (let i = 0; i < SANGUE_NUM_PARTICULAS; i++) {
    positions[i * 3] = posicao.x;
    positions[i * 3 + 1] = posicao.y;
    positions[i * 3 + 2] = posicao.z;

    // Espalha sobretudo na direção que o tiro estava indo (com uma
    // variação aleatória em volta), não em esfera completa.
    const variacao = new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.8
    );
    const direcaoFinal = direcaoTiro.clone().add(variacao).normalize();
    const velocidade = direcaoFinal.multiplyScalar(SANGUE_VELOCIDADE_ESPALHAMENTO * (0.4 + Math.random() * 0.6));

    velocidades[i * 3] = velocidade.x;
    velocidades[i * 3 + 1] = velocidade.y;
    velocidades[i * 3 + 2] = velocidade.z;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x8b0000, // vermelho escuro
    size: 0.035,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });

  const particulas = new THREE.Points(geometry, material);
  scene.add(particulas);

  SANGUE_EFEITOS_ATIVOS.push({
    particulas,
    velocidades,
    tempoRestante: SANGUE_DURACAO_SEGUNDOS,
  });
}

function atualizarEfeitosDeSangue(delta) {
  for (let i = SANGUE_EFEITOS_ATIVOS.length - 1; i >= 0; i--) {
    const efeito = SANGUE_EFEITOS_ATIVOS[i];
    const positions = efeito.particulas.geometry.attributes.position.array;

    for (let j = 0; j < SANGUE_NUM_PARTICULAS; j++) {
      efeito.velocidades[j * 3 + 1] += SANGUE_GRAVIDADE * delta;
      positions[j * 3] += efeito.velocidades[j * 3] * delta;
      positions[j * 3 + 1] += efeito.velocidades[j * 3 + 1] * delta;
      positions[j * 3 + 2] += efeito.velocidades[j * 3 + 2] * delta;
    }
    efeito.particulas.geometry.attributes.position.needsUpdate = true;

    efeito.tempoRestante -= delta;
    if (efeito.tempoRestante <= 0.25) {
      efeito.particulas.material.opacity = Math.max(0, efeito.tempoRestante / 0.25);
    }

    if (efeito.tempoRestante <= 0) {
      scene.remove(efeito.particulas);
      efeito.particulas.geometry.dispose();
      efeito.particulas.material.dispose();
      SANGUE_EFEITOS_ATIVOS.splice(i, 1);
    }
  }
}

// TESTE: posição temporária pra você ver o efeito funcionando. Me manda as
// coordenadas certas (do log [POS] no console) que eu troco esse valor.
const FOGOS_ARTIFICIO_POSICAO_TESTE = new THREE.Vector3(0, 5, -5);

// --- Lança-granada ---
// Lança um objeto físico de verdade (corpo rígido no Rapier, sofre
// gravidade e quica igual qualquer outra coisa no mundo). Depois de um
// tempo (o "pavio"), explode e cria fogo no local exato onde ela parou -
// reaproveitando o mesmo criarFogo() que já usamos nos PontoFogo do mapa.
const granadasAtivas = [];
const GRANADA_VELOCIDADE = 12; // força do lançamento (m/s)
const GRANADA_INCLINACAO_PARA_CIMA = 0.35; // dá um arco de lançamento mais natural
const GRANADA_FUSE_SEGUNDOS = 2.5; // tempo até explodir, tipo um pavio real
const GRANADA_RAIO = 0.06;
const GRANADA_RAIO_DANO = 4; // metros - alcance da explosão pra acertar o bandido

// Modelo real da granada (granada.glb). O arquivo veio bem maior do que o
// tamanho real de uma granada (~3 metros!), então aplicamos uma escala de
// correção pra ela ficar do tamanho certo (~9-12cm). Se você reexportar o
// modelo já no tamanho certo depois, é só ajustar/remover essa escala.
const GRANADA_ESCALA_CORRECAO = 0.042;
let granadaModeloTemplate = null; // guarda o modelo carregado, pra clonar a cada lançamento

// Cria uma instância visual da granada (clona o modelo real se já tiver
// carregado; se ainda não carregou, usa uma esfera simples como reserva,
// pra nunca travar o jogo esperando o arquivo).
function criarMeshDaGranada() {
  if (granadaModeloTemplate) {
    const clone = granadaModeloTemplate.clone(true);
    return clone;
  }

  const geometry = new THREE.SphereGeometry(GRANADA_RAIO, 12, 12);
  const material = new THREE.MeshStandardMaterial({ color: 0x2e3b2e, roughness: 0.6, metalness: 0.3 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function explodirGranada(posicao) {
  tocarSomDeExplosao(posicao);
  criarFogo(posicao);

  // Dano em área: se o bandido estiver perto o suficiente da explosão, acerta ele também.
  if (bandidoObjeto && bandidoVivo) {
    const posBandido = new THREE.Vector3();
    bandidoObjeto.getWorldPosition(posBandido);
    if (posBandido.distanceTo(posicao) <= GRANADA_RAIO_DANO) {
      acertarBandido();
    }
  }
}

function atualizarGranadas(delta) {
  for (let i = granadasAtivas.length - 1; i >= 0; i--) {
    const granada = granadasAtivas[i];
    const pos = granada.rigidBody.translation();
    granada.mesh.position.set(pos.x, pos.y, pos.z);

    granada.tempoRestante -= delta;
    if (granada.tempoRestante <= 0) {
      explodirGranada(new THREE.Vector3(pos.x, pos.y, pos.z));
      scene.remove(granada.mesh);
      physicsWorld.removeRigidBody(granada.rigidBody);
      granadasAtivas.splice(i, 1);
    }
  }
}

// --- Granada: pegar na mão e arremessar de verdade (mão esquerda) ---
// Diferente do lançamento por botão (que usa uma direção fixa), aqui a
// granada fica grudada na mão e segue o controle. Quando você solta o
// grip, a velocidade de arremesso vem do movimento REAL da sua mão nos
// últimos frames - igual jogar uma bola de verdade.
let granadaNaMao = null; // { mesh, controllerGrip, ultimaPosicao, velocidade }
const GRANADA_LANCAMENTO_MULTIPLICADOR = 3.2; // quanto maior, menos força de braço precisa pra ir longe

function pegarGranadaNaMao(controllerGrip) {
  if (granadaNaMao) return; // já está com uma na mão, não pega outra

  const mesh = criarMeshDaGranada();

  const posInicial = new THREE.Vector3();
  controllerGrip.getWorldPosition(posInicial);
  mesh.position.copy(posInicial);
  scene.add(mesh);

  granadaNaMao = {
    mesh,
    controllerGrip,
    ultimaPosicao: posInicial.clone(),
    velocidade: new THREE.Vector3(),
  };

  console.log('[DEBUG granada] Granada na mão! Faça o gesto de arremesso e solte o grip pra jogar.', 'posição:', posInicial);
}

function atualizarGranadaNaMao(delta) {
  if (!granadaNaMao || delta <= 0) return;

  const posAtual = new THREE.Vector3();
  granadaNaMao.controllerGrip.getWorldPosition(posAtual);
  granadaNaMao.mesh.position.copy(posAtual);

  // Velocidade instantânea da mão, suavizada com a anterior pra não tremer.
  const velocidadeInstantanea = posAtual.clone().sub(granadaNaMao.ultimaPosicao).divideScalar(delta);
  granadaNaMao.velocidade.lerp(velocidadeInstantanea, 0.6);
  granadaNaMao.ultimaPosicao.copy(posAtual);
}

function arremessarGranada() {
  if (!granadaNaMao) return;

  const { mesh, velocidade } = granadaNaMao;
  const posicao = mesh.position.clone();
  granadaNaMao = null;

  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(posicao.x, posicao.y, posicao.z);
  const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.ball(GRANADA_RAIO).setRestitution(0.35).setFriction(0.8);
  physicsWorld.createCollider(colliderDesc, rigidBody);

  const velocidadeLancamento = velocidade.clone().multiplyScalar(GRANADA_LANCAMENTO_MULTIPLICADOR);
  rigidBody.setLinvel(
    { x: velocidadeLancamento.x, y: velocidadeLancamento.y, z: velocidadeLancamento.z },
    true
  );

  granadasAtivas.push({ mesh, rigidBody, tempoRestante: GRANADA_FUSE_SEGUNDOS });

  console.log('Granada arremessada! Velocidade:', velocidadeLancamento.length().toFixed(1), 'm/s');
}

const loader = new GLTFLoader();

// Modelo real da granada (granada.glb). O arquivo veio bem maior do que o
// tamanho real de uma granada (~3 metros!), então aplicamos uma escala de
// correção pra ela ficar do tamanho certo (~9-12cm). Se você reexportar o
// modelo já no tamanho certo depois, é só ajustar/remover essa escala.
loader.load(
  '/granada.glb',
  (gltf) => {
    granadaModeloTemplate = gltf.scene;
    granadaModeloTemplate.scale.setScalar(GRANADA_ESCALA_CORRECAO);
    granadaModeloTemplate.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    console.log('[DEBUG granada] Modelo granada.glb carregado com sucesso.');
  },
  undefined,
  (erro) => {
    console.error('[DEBUG granada] FALHOU ao carregar granada.glb - usando esfera simples como reserva:', erro);
  }
);

let casaModel = null;
let portaPendente = null;

function criarColisorDaCasa(model, nomesParaIgnorar = []) {
  model.updateMatrixWorld(true);

  const vertices = [];
  const indices = [];
  let offsetIndice = 0;

  function estaDentroDeIgnorado(child) {
    let atual = child;
    while (atual) {
      if (nomesParaIgnorar.includes(atual.name)) return true;
      atual = atual.parent;
      if (atual === model.parent) break; // não sobe além do próprio "model"
    }
    return false;
  }

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (nomesParaIgnorar.length > 0 && estaDentroDeIgnorado(child)) return;

    const geometry = child.geometry;
    const posAttr = geometry.attributes.position;
    if (!posAttr) return;

    const vertice = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      vertice.fromBufferAttribute(posAttr, i);
      vertice.applyMatrix4(child.matrixWorld);
      vertices.push(vertice.x, vertice.y, vertice.z);
    }

    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) {
        indices.push(geometry.index.getX(i) + offsetIndice);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(i + offsetIndice);
      }
    }

    offsetIndice += posAttr.count;
  });

  if (vertices.length === 0) {
    console.warn('Nenhuma geometria encontrada na casa para gerar colisor.');
    return;
  }

  const casaRigidBody = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const casaColliderDesc = RAPIER.ColliderDesc.trimesh(
    new Float32Array(vertices),
    new Uint32Array(indices)
  );
  physicsWorld.createCollider(casaColliderDesc, casaRigidBody);

  console.log(`Colisor da casa criado: ${vertices.length / 3} vértices, ${indices.length / 3} triângulos.`);
}

// Cria uma "parede invisível" (sem nenhum visual, só física) - útil pra bloquear
// o jogador de voar/atravessar pra certas áreas do mapa.
// x, y, z = posição do CENTRO do bloqueio.
// largura, altura, profundidade = tamanho TOTAL do bloqueio (não a metade).
function criarBloqueioInvisivel(x, y, z, largura, altura, profundidade) {
  const rigidBody = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
  );
  const colliderDesc = RAPIER.ColliderDesc.cuboid(largura / 2, altura / 2, profundidade / 2);
  physicsWorld.createCollider(colliderDesc, rigidBody);
  console.log(`Bloqueio invisível criado em (${x}, ${y}, ${z}), tamanho ${largura}x${altura}x${profundidade}.`);
}

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
    casaModel = model;

    criarColisorDaCasa(model);

    console.log('--- Objetos dentro do UFA3.glb ---');
    model.traverse((child) => {
      if (child.isMesh) console.log(child.name);
    });
    console.log('-----------------------------------');

    const spawnPoint = model.getObjectByName('SpawnPoint');
    if (spawnPoint) {
      const worldPosition = new THREE.Vector3();
      spawnPoint.getWorldPosition(worldPosition);
      definirPosicaoFisicaDoJogador(worldPosition.x, worldPosition.y, worldPosition.z);
      console.log('SpawnPoint encontrado! Jogador posicionado em:', worldPosition);
    } else {
      console.warn('SpawnPoint não encontrado no modelo - usando posição padrão');
    }

    const pontosFogo = [];
    model.traverse((child) => {
      if (child.name && child.name.startsWith('PontoFogo')) {
        pontosFogo.push(child);
      }
    });

    if (pontosFogo.length > 0) {
      pontosFogo.forEach((ponto) => {
        const posicaoFogo = new THREE.Vector3();
        ponto.getWorldPosition(posicaoFogo);
        criarFogo(posicaoFogo);
      });
      console.log(`${pontosFogo.length} PontoFogo encontrado(s)! Fogo criado em cada um.`);
    } else {
      console.warn('Nenhum PontoFogo encontrado no modelo - fogo não foi criado.');
    }

    const areaDescidaObj = model.getObjectByName('AreaDescida');
    if (areaDescidaObj) {
      const centro = new THREE.Vector3();
      areaDescidaObj.getWorldPosition(centro);
      const escala = new THREE.Vector3();
      areaDescidaObj.getWorldScale(escala);
      areaDescida = { center: centro, halfX: escala.x, halfZ: escala.z };
      console.log('AreaDescida encontrada! Centro:', centro, '- meio-tamanho X/Z:', escala.x, escala.z);
    } else {
      console.warn('AreaDescida não encontrada no modelo - descida automática desativada.');
    }

    model.traverse((child) => {
      if (child.name && child.name.startsWith('Pegavel_')) {
        objetosPegaveis.push(child);
      }
    });

    if (objetosPegaveis.length > 0) {
      console.log(`${objetosPegaveis.length} objeto(s) pegável(is) encontrado(s):`, objetosPegaveis.map((o) => o.name));
    } else {
      console.warn('Nenhum objeto "Pegavel_*" encontrado no modelo - nada pra pegar ainda.');
    }

    // Qualquer objeto/cubo no Blender com nome começando com "Bloqueio_" vira uma
    // colisão invisível automaticamente, no tamanho e posição exatos do cubo.
    // O cubo em si fica escondido (não aparece no jogo, só serve de marcador).
    const bloqueios = [];
    model.traverse((child) => {
      if (child.name && child.name.startsWith('Bloqueio_')) {
        bloqueios.push(child);
      }
    });

    bloqueios.forEach((cubo) => {
      const caixa = new THREE.Box3().setFromObject(cubo);
      const centro = new THREE.Vector3();
      const tamanho = new THREE.Vector3();
      caixa.getCenter(centro);
      caixa.getSize(tamanho);

      criarBloqueioInvisivel(centro.x, centro.y, centro.z, tamanho.x, tamanho.y, tamanho.z);
      cubo.visible = false; // esconde o cubo, ele é só um marcador
    });

    if (bloqueios.length > 0) {
      console.log(`${bloqueios.length} bloqueio(s) invisível(is) criado(s) a partir de cubos "Bloqueio_*".`);
    }

    const destinoDescidaObj = model.getObjectByName('DestinoDescida');
    if (destinoDescidaObj) {
      destinoDescida = new THREE.Vector3();
      destinoDescidaObj.getWorldPosition(destinoDescida);
      console.log('DestinoDescida encontrado! Posição:', destinoDescida);
    } else {
      console.warn('DestinoDescida não encontrado no modelo - descida automática desativada.');
    }

    if (portaPendente) {
      casaModel.add(portaPendente);
      portaPendente = null;
      console.log('Porta encaixada na casa (casa carregou depois).');
    }

    if (portaBopeDireitaPendente) {
      casaModel.add(portaBopeDireitaPendente);
      portaBopeDireitaPendente = null;
      console.log('Porta direita BOPE encaixada na casa (casa carregou depois).');
    }

    if (portaBopeEsquerdaPendente) {
      casaModel.add(portaBopeEsquerdaPendente);
      portaBopeEsquerdaPendente = null;
      console.log('Porta esquerda BOPE encaixada na casa (casa carregou depois).');
    }

    if (elevadorPendente) {
      casaModel.add(elevadorPendente);
      elevadorPendente = null;
      console.log('Elevador encaixado na casa (casa carregou depois).');
    }

    if (spawnPoint2Pendente) {
      casaModel.add(spawnPoint2Pendente.grupo);
      aplicarSpawnPoint2(spawnPoint2Pendente.node);
      spawnPoint2Pendente = null;
      console.log('SpawnPoint2 encaixado na casa (casa carregou depois).');
    }

    if (carroBopePendente) {
      casaModel.add(carroBopePendente);
      criarColisorDaCasa(carroBopePendente, ['bopedireito', 'bopeesquerdo']);
      carroBopePendente = null;
      console.log('Carro BOPE encaixado na casa (casa carregou depois) e colisor criado (sem colisão nas portas).');
    }

    if (telaVideoPendente) {
      casaModel.add(telaVideoPendente);
      telaVideoPendente = null;
      console.log('Tela de vídeo encaixada na casa (casa carregou depois).');
    }

    if (policiaSentadoPendente) {
      casaModel.add(policiaSentadoPendente);
      policiaSentadoPendente = null;
      console.log('Policial sentado encaixado na casa (casa carregou depois).');
    }

    if (bandidoVoltaPendente) {
      casaModel.add(bandidoVoltaPendente);
      bandidoVoltaPendente = null;
      console.log('Bandido (volta) encaixado na casa (casa carregou depois).');
    }

    if (bandidoAnimadoPendente) {
      casaModel.add(bandidoAnimadoPendente);
      posicionarBandidoNoMundo();
      bandidoAnimadoPendente = null;
      console.log('Bandido armado encaixado na casa (casa carregou depois).');
    }

    if (bandido2AnimadoPendente) {
      casaModel.add(bandido2AnimadoPendente);
      posicionarBandido2NoMundo();
      bandido2AnimadoPendente = null;
      console.log('Segundo bandido encaixado na casa (casa carregou depois).');
    }

    if (bondinhoPendente) {
      casaModel.add(bondinhoPendente);
      bondinhoPendente = null;
      console.log('Bondinho encaixado na casa (casa carregou depois).');
    }

    if (trilhoPendente) {
      casaModel.add(trilhoPendente);
      trilhoPendente = null;
      console.log('Trilho encaixado na casa (casa carregou depois).');
    }

    if (cenarioPendente) {
      casaModel.add(cenarioPendente);
      cenarioPendente = null;
      console.log('Cenario encaixado na casa (casa carregou depois).');
    }

    if (busPendente) {
      casaModel.add(busPendente);
      busPendente = null;
      console.log('Ônibus encaixado na casa (casa carregou depois).');
    }

    if (bodycamPendente) {
      casaModel.add(bodycamPendente);
      objetosPegaveis.push(bodycamPendente);
      bodycamPendente = null;
      console.log('Bodycam encaixada na casa (casa carregou depois) e registrada como pegável.');
    }

    if (postesPendente) {
      casaModel.add(postesPendente);
      postesPendente = null;
      console.log('Postes encaixados na casa (casa carregou depois).');
    }

    if (barricadaPendente) {
      casaModel.add(barricadaPendente);
      barricadaPendente = null;
      console.log('Barricada encaixada na casa (casa carregou depois).');
    }

    if (casasPendente) {
      casaModel.add(casasPendente);
      criarColisorDaCasa(casasPendente);
      casasPendente = null;
      console.log('Casas encaixadas na cena (casa carregou depois) e colisor criado.');
    }

    if (paredaoPendente) {
      casaModel.add(paredaoPendente);
      criarColisorDaCasa(paredaoPendente);
      paredaoPendente = null;
      console.log('Paredão encaixado na cena (casa carregou depois) e colisor criado.');
    }

    console.log('Modelo carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o modelo:', error);
  }
);

const audioListener = new THREE.AudioListener();
camera.add(audioListener);

const somPorta = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader();
audioLoader.load('/porta.mp3', (buffer) => {
  somPorta.setBuffer(buffer);
  somPorta.setVolume(0.6);
});

function tocarSomDaPorta() {
  if (somPorta.isPlaying) somPorta.stop();
  somPorta.play();
}

const TIRO_POOL_TAMANHO = 6;
const somTiroPool = [];
let somTiroIndex = 0;

audioLoader.load('/tiro.mp3', (buffer) => {
  for (let i = 0; i < TIRO_POOL_TAMANHO; i++) {
    const somTiro = new THREE.Audio(audioListener);
    somTiro.setBuffer(buffer);
    somTiro.setVolume(0.7);
    somTiroPool.push(somTiro);
  }
});

function tocarSomDeTiro() {
  if (somTiroPool.length === 0) return;

  const somTiro = somTiroPool[somTiroIndex];
  somTiroIndex = (somTiroIndex + 1) % somTiroPool.length;

  if (somTiro.isPlaying) somTiro.stop();
  somTiro.play();
}

// --- Sistema de munição/recarga ---
// Carregador com capacidade limitada. A reserva é "infinita" (sempre dá
// pra recarregar) - o que muda o ritmo do combate é o TEMPO que a recarga
// leva, não falta de balas de vez.
const MUNICAO_CAPACIDADE = 12;
const RECARGA_DURACAO_MS = 1440; // sincronizado com a duração real do som de recarga
let municaoAtual = MUNICAO_CAPACIDADE;
let recarregando = false;

// Som de recarregar a pistola.
const somDeRecarga = new THREE.Audio(audioListener);
audioLoader.load(
  '/pistolacarrego.mp3',
  (buffer) => {
    somDeRecarga.setBuffer(buffer);
    somDeRecarga.setVolume(1.0);
    console.log('[DEBUG áudio] pistolacarrego.mp3 carregado com sucesso.');
  },
  undefined,
  (erro) => {
    console.error('[DEBUG áudio] FALHOU ao carregar pistolacarrego.mp3 - confira se o arquivo está na pasta raiz do projeto:', erro);
  }
);

function tocarSomDeRecarga() {
  if (!somDeRecarga.buffer) return;
  if (somDeRecarga.isPlaying) somDeRecarga.stop();
  somDeRecarga.play();
}


// Som de "clique seco" quando tenta atirar sem munição - gerado por código
// (Web Audio), sem precisar de arquivo externo.
function tocarSomDeClique() {
  if (sfxAudioCtx.state === 'suspended') sfxAudioCtx.resume();

  const agora = sfxAudioCtx.currentTime;
  const oscillator = sfxAudioCtx.createOscillator();
  const gainNode = sfxAudioCtx.createGain();

  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(180, agora);
  gainNode.gain.setValueAtTime(0.25, agora);
  gainNode.gain.exponentialRampToValueAtTime(0.001, agora + 0.05);

  oscillator.connect(gainNode);
  gainNode.connect(sfxAudioCtx.destination);
  oscillator.start(agora);
  oscillator.stop(agora + 0.05);
}

function recarregar() {
  const armaAtiva = jogoAtivo || modoCombateAtivo;
  if (!armaAtiva || recarregando || municaoAtual === MUNICAO_CAPACIDADE) return;

  recarregando = true;
  atualizarHUDMunicao();
  tocarSomDeRecarga();
  console.log('Recarregando...');

  setTimeout(() => {
    municaoAtual = MUNICAO_CAPACIDADE;
    recarregando = false;
    atualizarHUDMunicao();
    console.log('Recarregado!');
  }, RECARGA_DURACAO_MS);
}

// Atalho pra redesenhar só quando a munição muda (evita redesenhar o HUD
// inteiro sem necessidade).
function atualizarHUDMunicao() {
  desenharHUD();
}

// Som de "bala passando perto" - toca junto com o aviso/vinheta quando o
// jogador leva um tiro (não é o tiro do jogador, é o efeito de ter sido
// atingido/quase atingido).
const somBalaPassando = new THREE.Audio(audioListener);
audioLoader.load('/balas-passando.mp3', (buffer) => {
  somBalaPassando.setBuffer(buffer);
  somBalaPassando.setVolume(0.8);
});

function tocarSomDeBalaPassando() {
  if (somBalaPassando.isPlaying) somBalaPassando.stop();
  somBalaPassando.play();
}

// Som de tiro de pistola - toca uma vez quando o BANDIDO leva um tiro
// (quando você mira e acerta ele), não confundir com o som de disparo
// do jogador (tocarSomDeTiro) nem com a bala passando perto de você
// (tocarSomDeBalaPassando).
const somTiroNoBandido = new THREE.Audio(audioListener);
audioLoader.load(
  '/tiro-pistola-bandido.mp3',
  (buffer) => {
    somTiroNoBandido.setBuffer(buffer);
    somTiroNoBandido.setVolume(1.5); // acima de 1.0 = amplifica além do volume original do arquivo
    console.log('[DEBUG áudio] tiro-pistola-bandido.mp3 carregado com sucesso.');
  },
  undefined,
  (erro) => {
    console.error('[DEBUG áudio] FALHOU ao carregar tiro-pistola-bandido.mp3 - confira se o arquivo está na pasta raiz do projeto:', erro);
  }
);

function tocarSomDeTiroNoBandido() {
  if (!somTiroNoBandido.buffer) {
    console.warn('[DEBUG áudio] tentou tocar tiro-pistola-bandido.mp3 mas o buffer ainda não carregou (ou falhou ao carregar).');
    return;
  }
  if (somTiroNoBandido.isPlaying) somTiroNoBandido.stop();
  somTiroNoBandido.play();
}

// Grito de ameaça do bandido - POSICIONAL (não é THREE.Audio comum, é
// THREE.PositionalAudio). Isso faz o som vir de verdade da posição dele:
// mais alto perto, mais baixo longe, e com direção (você "sente" de que
// lado vem, se o headset suportar áudio espacial).
const gritoAmeacaBandido = new THREE.PositionalAudio(audioListener);
gritoAmeacaBandido.setRefDistance(8); // distância (m) onde o som já começa a diminuir
gritoAmeacaBandido.setRolloffFactor(1.2); // quão rápido cai o volume com a distância
gritoAmeacaBandido.setMaxDistance(80); // além disso, praticamente inaudível
gritoAmeacaBandido.setDistanceModel('exponential');

audioLoader.load(
  '/audioameaca.wav',
  (buffer) => {
    gritoAmeacaBandido.setBuffer(buffer);
    gritoAmeacaBandido.setVolume(1.5); // o arquivo em si já foi amplificado, esse é só um extra
    console.log('[DEBUG áudio] audioameaca.wav carregado com sucesso.');
  },
  undefined,
  (erro) => {
    console.error('[DEBUG áudio] FALHOU ao carregar audioameaca.wav - confira se o arquivo está na pasta raiz do projeto:', erro);
  }
);

function tocarGritoDeAmeacaDoBandido() {
  if (!gritoAmeacaBandido.buffer) {
    console.warn('[DEBUG áudio] tentou tocar audioameaca.wav mas o buffer ainda não carregou (ou falhou ao carregar).');
    return;
  }
  if (gritoAmeacaBandido.isPlaying) gritoAmeacaBandido.stop();
  gritoAmeacaBandido.play();
}

// Som de explosão da granada - POSICIONAL, mas diferente do grito do
// bandido (que fica grudado num objeto fixo), a explosão acontece num
// lugar diferente toda vez. Por isso usamos uma "âncora" (Object3D vazio)
// que a gente reposiciona pro ponto exato da explosão antes de tocar.
const explosaoAncoraAudio = new THREE.Object3D();
scene.add(explosaoAncoraAudio);

const somExplosaoGranada = new THREE.PositionalAudio(audioListener);
somExplosaoGranada.setRefDistance(10);
somExplosaoGranada.setRolloffFactor(1.2);
somExplosaoGranada.setMaxDistance(150);
somExplosaoGranada.setDistanceModel('exponential');
explosaoAncoraAudio.add(somExplosaoGranada);

audioLoader.load(
  '/explosao-granada.mp3',
  (buffer) => {
    somExplosaoGranada.setBuffer(buffer);
    somExplosaoGranada.setVolume(1.5);
    console.log('[DEBUG áudio] explosao-granada.mp3 carregado com sucesso.');
  },
  undefined,
  (erro) => {
    console.error('[DEBUG áudio] FALHOU ao carregar explosao-granada.mp3 - confira se o arquivo está na pasta raiz do projeto:', erro);
  }
);

function tocarSomDeExplosao(posicao) {
  if (!somExplosaoGranada.buffer) {
    console.warn('[DEBUG áudio] tentou tocar explosao-granada.mp3 mas o buffer ainda não carregou (ou falhou ao carregar).');
    return;
  }
  explosaoAncoraAudio.position.copy(posicao);
  explosaoAncoraAudio.updateMatrixWorld(true);
  if (somExplosaoGranada.isPlaying) somExplosaoGranada.stop();
  somExplosaoGranada.play();
}

let mixerPorta = null;
let portaAction = null;
let portaObjeto = null;
let portaAberta = false;

loader.load(
  '/portagaragem.glb',
  (gltf) => {
    const model = gltf.scene;

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    portaObjeto = model;

    if (casaModel) {
      casaModel.add(model);
      console.log('Porta encaixada na casa (porta carregou depois).');
    } else {
      portaPendente = model;
    }

    console.log('Animações encontradas no portagaragem.glb:', gltf.animations.map((c) => c.name));

    if (gltf.animations.length > 0) {
      mixerPorta = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      portaAction = mixerPorta.clipAction(clip);
      portaAction.setLoop(THREE.LoopOnce);
      portaAction.clampWhenFinished = true;

      portaAction.play();
      portaAction.paused = true;
      portaAction.time = 0;
      mixerPorta.update(0);
      portaAberta = false;

      console.log(`Clip "${clip.name}" pronta para a porta da garagem.`);
    } else {
      console.warn('Nenhuma animação encontrada no portagaragem.glb.');
    }

    console.log('Porta da garagem carregada com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a porta da garagem:', error);
  }
);

let totemObjeto = null;
let mixerTotem = null;
let portaEsquerdaAction = null;
let portaDireitaAction = null;
let portasTotemAbertas = false;

loader.load(
  '/totem.glb',
  (gltf) => {
    const model = gltf.scene;
    model.position.z -= 3;

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

    totemObjeto = model.getObjectByName('TotemClique');
    const portaEsquerdaObjeto = model.getObjectByName('PortaEsquerda');
    const portaDireitaObjeto = model.getObjectByName('PortaDireita');

    mixerTotem = new THREE.AnimationMixer(model);

    const clipEsquerda = gltf.animations.find((c) => c.name === 'PortaEsquerda_Abrir');
    const clipDireita = gltf.animations.find((c) => c.name === 'PortaDireita_Abrir');

    if (clipEsquerda) {
      portaEsquerdaAction = mixerTotem.clipAction(clipEsquerda, portaEsquerdaObjeto);
      portaEsquerdaAction.setLoop(THREE.LoopOnce);
      portaEsquerdaAction.clampWhenFinished = true;
      portaEsquerdaAction.play();
      portaEsquerdaAction.paused = true;
      portaEsquerdaAction.time = 0;
    }

    if (clipDireita) {
      portaDireitaAction = mixerTotem.clipAction(clipDireita, portaDireitaObjeto);
      portaDireitaAction.setLoop(THREE.LoopOnce);
      portaDireitaAction.clampWhenFinished = true;
      portaDireitaAction.play();
      portaDireitaAction.paused = true;
      portaDireitaAction.time = 0;
    }

    mixerTotem.update(0);

    console.log('Totem carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o totem:', error);
  }
);

function verificarInteracaoTotem(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  if (!totemObjeto || (!portaEsquerdaAction && !portaDireitaAction)) return;

  const intersects = raycaster.intersectObject(totemObjeto, true);
  if (intersects.length > 0) {
    console.log('Acertou o totem! Abrindo/fechando as portas...');
    portasTotemAbertas = !portasTotemAbertas;
    const timeScale = portasTotemAbertas ? 1 : -1;

    [portaEsquerdaAction, portaDireitaAction].forEach((action) => {
      if (!action) return;
      action.paused = false;
      action.timeScale = timeScale;
      if (portasTotemAbertas) {
        action.reset();
        action.timeScale = timeScale;
      }
      action.play();
    });

    if (portasTotemAbertas) {
      iniciarJogo();
    } else {
      pararJogo();
    }

    alvos.forEach((alvo) => {
      clearTimeout(alvo.timeoutId);
      if (portasTotemAbertas) {
        surgirAlvo(alvo);
      } else {
        sumirAlvo(alvo);
      }
    });

    tocarSomDaPorta();
  }
}

let mixerPortaBopeDireita = null;
let portaBopeDireitaAction = null;
let portaBopeDireitaObjeto = null;
let portaBopeDireitaPendente = null;

let mixerPortaBopeEsquerda = null;
let portaBopeEsquerdaAction = null;
let portaBopeEsquerdaObjeto = null;
let portaBopeEsquerdaPendente = null;

let portasBopeAbertas = false;

loader.load(
  '/portadireitabope.glb',
  (gltf) => {
    const model = gltf.scene;

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    portaBopeDireitaObjeto = model;

    if (casaModel) {
      casaModel.add(model);
    } else {
      portaBopeDireitaPendente = model;
    }

    if (gltf.animations.length > 0) {
      mixerPortaBopeDireita = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      portaBopeDireitaAction = mixerPortaBopeDireita.clipAction(clip);
      portaBopeDireitaAction.setLoop(THREE.LoopOnce);
      portaBopeDireitaAction.clampWhenFinished = true;
      portaBopeDireitaAction.play();
      portaBopeDireitaAction.paused = true;
      portaBopeDireitaAction.time = 0;
      mixerPortaBopeDireita.update(0);
    }

    console.log('Porta direita BOPE carregada com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a porta direita BOPE:', error);
  }
);

loader.load(
  '/portaesquerdabope.glb',
  (gltf) => {
    const model = gltf.scene;

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    portaBopeEsquerdaObjeto = model;

    if (casaModel) {
      casaModel.add(model);
    } else {
      portaBopeEsquerdaPendente = model;
    }

    if (gltf.animations.length > 0) {
      mixerPortaBopeEsquerda = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      portaBopeEsquerdaAction = mixerPortaBopeEsquerda.clipAction(clip);
      portaBopeEsquerdaAction.setLoop(THREE.LoopOnce);
      portaBopeEsquerdaAction.clampWhenFinished = true;
      portaBopeEsquerdaAction.play();
      portaBopeEsquerdaAction.paused = true;
      portaBopeEsquerdaAction.time = 0;
      mixerPortaBopeEsquerda.update(0);
    }

    console.log('Porta esquerda BOPE carregada com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a porta esquerda BOPE:', error);
  }
);

function verificarInteracaoPortasBope(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  if (!portaBopeDireitaObjeto && !portaBopeEsquerdaObjeto) return;

  const portasBope = [portaBopeDireitaObjeto, portaBopeEsquerdaObjeto].filter(Boolean);
  const intersects = raycaster.intersectObjects(portasBope, true);

  if (intersects.length > 0) {
    console.log('Acertou uma das portas BOPE! Abrindo/fechando as duas...');
    portasBopeAbertas = !portasBopeAbertas;
    const timeScale = portasBopeAbertas ? 1 : -1;

    [portaBopeDireitaAction, portaBopeEsquerdaAction].forEach((action) => {
      if (!action) return;
      action.paused = false;
      action.timeScale = timeScale;
      if (portasBopeAbertas) {
        action.reset();
        action.timeScale = timeScale;
      }
      action.play();
    });

    tocarSomDaPorta();
  }
}

let areaDescida = null;
let destinoDescida = null;
let jaEstaNaAreaDescida = false;
const objetosPegaveis = [];

function verificarAreaDescida() {
  if (!areaDescida || !destinoDescida) return;

  const dx = Math.abs(player.position.x - areaDescida.center.x);
  const dz = Math.abs(player.position.z - areaDescida.center.z);
  const dentroDaArea = dx <= areaDescida.halfX && dz <= areaDescida.halfZ;

  if (dentroDaArea && !jaEstaNaAreaDescida) {
    jaEstaNaAreaDescida = true;
    definirPosicaoFisicaDoJogador(destinoDescida.x, destinoDescida.y, destinoDescida.z);
    console.log('Jogador entrou na área da porta do carro - descendo de nível automaticamente.');
  } else if (!dentroDaArea) {
    jaEstaNaAreaDescida = false;
  }
}

let elevadorObjeto = null;
let elevadorPendente = null;
let spawnPoint2Pendente = null;
let spawnPoint2Position = null;

function aplicarSpawnPoint2(spawnNode) {
  const worldPosition = new THREE.Vector3();
  spawnNode.getWorldPosition(worldPosition);
  spawnPoint2Position = worldPosition;
  console.log('SpawnPoint2 encontrado! Destino do elevador:', worldPosition);
}

loader.load(
  '/elevador.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    elevadorObjeto = model;

    if (casaModel) {
      casaModel.add(model);
      console.log('Elevador encaixado na casa.');
    } else {
      elevadorPendente = model;
    }

    console.log('Elevador carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o elevador:', error);
  }
);

loader.load(
  '/spawnpoint2.glb',
  (gltf) => {
    const grupo = gltf.scene;
    const spawnNode = grupo.getObjectByName('SpawnPoint2') || grupo;

    if (casaModel) {
      casaModel.add(grupo);
      aplicarSpawnPoint2(spawnNode);
    } else {
      spawnPoint2Pendente = { grupo, node: spawnNode };
    }
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o spawnpoint2:', error);
  }
);

let mixerCarroBope = null;
let carroBopeAction = null;
let carroBopeDireitoAction = null;
let carroBopeEsquerdoAction = null;
let carroBopePendente = null;

function configurarAcoesDoCarroBope(model, gltf) {
  mixerCarroBope = new THREE.AnimationMixer(model);

  const clipBope = gltf.animations.find((c) => c.name === 'bope');
  const clipBopeDireito = gltf.animations.find((c) => c.name === 'bopedireito');
  const clipBopeEsquerdo = gltf.animations.find((c) => c.name === 'Plane.061Action');

  const nodeBope = model.getObjectByName('bope');
  const nodeBopeDireito = model.getObjectByName('bopedireito');
  const nodeBopeEsquerdo = model.getObjectByName('bopeesquerdo');

  const configurarAction = (clip, node) => {
    if (!clip || !node) return null;
    const action = mixerCarroBope.clipAction(clip, node);
    action.setLoop(THREE.LoopOnce);
    action.clampWhenFinished = true;
    return action;
  };

  carroBopeAction = configurarAction(clipBope, nodeBope);
  carroBopeDireitoAction = configurarAction(clipBopeDireito, nodeBopeDireito);
  carroBopeEsquerdoAction = configurarAction(clipBopeEsquerdo, nodeBopeEsquerdo);

  mixerCarroBope.update(0);
}

loader.load(
  '/carrobope.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    configurarAcoesDoCarroBope(model, gltf);

    if (casaModel) {
      casaModel.add(model);
      criarColisorDaCasa(model, ['bopedireito', 'bopeesquerdo']);
      console.log('Carro BOPE encaixado na casa e colisor criado (sem colisão nas portas).');
    } else {
      carroBopePendente = model;
    }

    console.log('Carro BOPE carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o carro BOPE:', error);
  }
);

function tocarAnimacaoDoCarroBope() {
  [carroBopeAction, carroBopeDireitoAction, carroBopeEsquerdoAction].forEach((action) => {
    if (!action) return;
    action.paused = false;
    action.timeScale = 1;
    action.reset();
    action.play();
  });
}

let telaVideoPendente = null;

const videoElemento = document.createElement('video');
videoElemento.src = '/video-tela.mp4';
videoElemento.crossOrigin = 'anonymous';
videoElemento.loop = false;
videoElemento.playsInline = true;
videoElemento.muted = false;

const videoTexture = new THREE.VideoTexture(videoElemento);
videoTexture.colorSpace = THREE.SRGBColorSpace;

function aplicarTexturaDeVideo(telaNode) {
  telaNode.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshBasicMaterial({ map: videoTexture });
    }
  });
}

loader.load(
  '/telavideo.glb',
  (gltf) => {
    const model = gltf.scene;
    const telaNode = model.getObjectByName('TelaVideo') || model;
    aplicarTexturaDeVideo(telaNode);

    if (casaModel) {
      casaModel.add(model);
      console.log('Tela de vídeo encaixada na casa.');
    } else {
      telaVideoPendente = model;
    }

    console.log('Tela de vídeo carregada com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a tela de vídeo:', error);
  }
);

let mixerPoliciaSentado = null;
let policiaSentadoPendente = null;

loader.load(
  '/policiasentadocerto.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (gltf.animations && gltf.animations.length > 0) {
      mixerPoliciaSentado = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        const action = mixerPoliciaSentado.clipAction(clip);
        action.setLoop(THREE.LoopRepeat);
        action.play();
      });
    }

    if (casaModel) {
      casaModel.add(model);
      console.log('Policial sentado encaixado na casa.');
    } else {
      policiaSentadoPendente = model;
    }

    console.log('Policial sentado carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o policial sentado:', error);
  }
);

let mixerBandidoVolta = null;
let bandidoVoltaPendente = null;

loader.load(
  '/bandidovolta.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (gltf.animations && gltf.animations.length > 0) {
      mixerBandidoVolta = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        const action = mixerBandidoVolta.clipAction(clip);
        action.setLoop(THREE.LoopRepeat);
        action.play();
      });
    }

    if (casaModel) {
      casaModel.add(model);
      console.log('Bandido (volta) encaixado na casa.');
    } else {
      bandidoVoltaPendente = model;
    }

    console.log('Bandido (volta) carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o bandido (volta):', error);
  }
);

let mixerBandidoAnimado = null;
let bandidoObjeto = null;
let bandidoAtirandoAction = null;
let bandidoMorrendoAction = null;
let bandidoVivo = false;
let bandidoAnimadoPendente = null;

// Posição desejada do bandido em coordenadas de MUNDO (a mesma leitura que
// aparece no painel verde de debug). Como o bandido é encaixado como filho
// da casa (casaModel), não dá pra usar esse valor direto em position.set -
// a casa pode estar deslocada da origem. A função posicionarBandidoNoMundo()
// converte esse valor de mundo pra posição local certa, seja qual for o pai.
const BANDIDO_POSICAO_MUNDO = new THREE.Vector3(74.48, 16.74, -90.74);

function posicionarBandidoNoMundo() {
  if (!bandidoObjeto || !bandidoObjeto.parent) return;
  const local = BANDIDO_POSICAO_MUNDO.clone();
  bandidoObjeto.parent.worldToLocal(local);
  bandidoObjeto.position.copy(local);
}

loader.load(
  '/bandidoatirando.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    bandidoObjeto = model;
    mixerBandidoAnimado = new THREE.AnimationMixer(model);

    const clipAtirando = gltf.animations.find((c) => c.name === 'Armature|mixamo.com|Layer0');
    const clipMorrendo = null; // esse arquivo (bandidoatirando.glb) só tem a animação de atirar

    if (clipAtirando) {
      bandidoAtirandoAction = mixerBandidoAnimado.clipAction(clipAtirando);
      bandidoAtirandoAction.setLoop(THREE.LoopRepeat);
      bandidoAtirandoAction.play();
    } else {
      console.warn('Não achei a animação de atirar do bandido armado.');
    }

    if (clipMorrendo) {
      bandidoMorrendoAction = mixerBandidoAnimado.clipAction(clipMorrendo);
      bandidoMorrendoAction.setLoop(THREE.LoopOnce);
      bandidoMorrendoAction.clampWhenFinished = true;
    } else {
      console.warn('Não achei a animação de morte do bandido armado.');
    }

    bandidoVivo = true;

    // Som de "grito de ameaça" - posicional, gruda na posição real do
    // bandido, então o volume/direção mudam naturalmente conforme você se
    // aproxima, se afasta ou vira a cabeça (igual um som de verdade viria
    // de longe).
    model.add(gritoAmeacaBandido);

    if (casaModel) {
      casaModel.add(model);
      posicionarBandidoNoMundo();
      console.log('Bandido armado encaixado na casa.');
    } else {
      bandidoAnimadoPendente = model;
    }

    console.log('Bandido armado carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o bandido armado:', error);
  }
);

// --- Detecção de "onde acertou" (cabeça, braço, tronco, perna) ---
// Acha o osso do esqueleto mais próximo do ponto de impacto e traduz o
// nome dele (padrão Mixamo, tipo "mixamorig:Head") pra uma região legível.
function mapearOssoParaRegiao(nomeOsso) {
  const nome = nomeOsso.toLowerCase();
  if (nome.includes('head') || nome.includes('neck')) return 'CABEÇA';
  if (nome.includes('arm') || nome.includes('hand') || nome.includes('shoulder')) return 'BRAÇO';
  if (nome.includes('leg') || nome.includes('foot') || nome.includes('toe')) return 'PERNA';
  return 'TRONCO'; // spine, hips, etc
}

function encontrarRegiaoAtingida(alvoObjeto, pontoImpacto) {
  let skinnedMesh = null;
  alvoObjeto.traverse((child) => {
    if (!skinnedMesh && child.isSkinnedMesh) skinnedMesh = child;
  });
  if (!skinnedMesh || !skinnedMesh.skeleton) return null;

  let ossoMaisProximo = null;
  let menorDistancia = Infinity;
  const posOsso = new THREE.Vector3();

  for (const osso of skinnedMesh.skeleton.bones) {
    osso.getWorldPosition(posOsso);
    const distancia = posOsso.distanceTo(pontoImpacto);
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      ossoMaisProximo = osso;
    }
  }

  if (!ossoMaisProximo) return null;
  return mapearOssoParaRegiao(ossoMaisProximo.name);
}

// Indicador rápido na tela mostrando onde acertou (ex: "CABEÇA"), some
// sozinho depois de um tempo curto. Reaproveita o mesmo canvas-plano
// preso à câmera que já usamos no HUD/aviso.
const indicadorAcertoCanvas = document.createElement('canvas');
indicadorAcertoCanvas.width = 512;
indicadorAcertoCanvas.height = 150;
const indicadorAcertoCtx = indicadorAcertoCanvas.getContext('2d');
const indicadorAcertoTexture = new THREE.CanvasTexture(indicadorAcertoCanvas);

const indicadorAcertoMaterial = new THREE.MeshBasicMaterial({
  map: indicadorAcertoTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
});
const indicadorAcertoPlano = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.16), indicadorAcertoMaterial);
indicadorAcertoPlano.position.set(0, -0.15, -0.6); // um pouco abaixo do centro
indicadorAcertoPlano.renderOrder = 1001;
indicadorAcertoPlano.visible = false;
camera.add(indicadorAcertoPlano);

const INDICADOR_ACERTO_DURACAO_MS = 900;
let indicadorAcertoTempoRestanteMs = 0;

function mostrarIndicadorDeAcerto(regiao) {
  if (!regiao) return;

  indicadorAcertoCtx.clearRect(0, 0, indicadorAcertoCanvas.width, indicadorAcertoCanvas.height);
  const corDeFundo = regiao === 'CABEÇA' ? 'rgba(180, 30, 0, 0.85)' : 'rgba(0, 0, 0, 0.7)';
  indicadorAcertoCtx.fillStyle = corDeFundo;
  indicadorAcertoCtx.fillRect(0, 0, indicadorAcertoCanvas.width, indicadorAcertoCanvas.height);
  indicadorAcertoCtx.strokeStyle = '#ffffff';
  indicadorAcertoCtx.lineWidth = 4;
  indicadorAcertoCtx.strokeRect(4, 4, indicadorAcertoCanvas.width - 8, indicadorAcertoCanvas.height - 8);

  indicadorAcertoCtx.textAlign = 'center';
  indicadorAcertoCtx.textBaseline = 'middle';
  indicadorAcertoCtx.fillStyle = '#ffffff';
  indicadorAcertoCtx.font = 'bold 54px sans-serif';
  const texto = regiao === 'CABEÇA' ? 'HEADSHOT!' : `ACERTOU: ${regiao}`;
  indicadorAcertoCtx.fillText(texto, indicadorAcertoCanvas.width / 2, indicadorAcertoCanvas.height / 2);

  indicadorAcertoTexture.needsUpdate = true;
  indicadorAcertoMaterial.opacity = 1;
  indicadorAcertoPlano.visible = true;
  indicadorAcertoTempoRestanteMs = INDICADOR_ACERTO_DURACAO_MS;
}

function atualizarIndicadorDeAcerto(delta) {
  if (indicadorAcertoTempoRestanteMs <= 0) return;
  indicadorAcertoTempoRestanteMs -= delta * 1000;
  if (indicadorAcertoTempoRestanteMs <= 200) {
    indicadorAcertoMaterial.opacity = Math.max(0, indicadorAcertoTempoRestanteMs / 200);
  }
  if (indicadorAcertoTempoRestanteMs <= 0) {
    indicadorAcertoPlano.visible = false;
  }
}

function acertarBandido() {
  if (!bandidoVivo) return;
  bandidoVivo = false;
  tirosCertos += 1;
  justificativasDeUsoDaForca.push({
    alvo: 'bandido_1',
    motivo: 'ameaca_armada',
    descricao: 'Ameaça armada - suspeito em confronto ativo',
    timestamp: new Date().toISOString(),
  });
  registrarEventoDeSessao('evento_missao', 'Ameaça neutralizada (suspeito 1)', false);

  if (bandidoAtirandoAction) bandidoAtirandoAction.stop();

  tocarSomDeTiroNoBandido();

  // Some na hora, garantido - não importa a distância nem se a animação de
  // morte carregou certinho ou não. Só acontece aqui: quando VOCÊ mira e
  // acerta ele. Em nenhuma outra hipótese.
  if (bandidoObjeto) bandidoObjeto.visible = false;

  // Se a animação de morte existir, ainda toca ela (caso você queira
  // reaproveitar isso depois, tipo pra reaparecer o bandido em outro lugar).
  // Mas a visibilidade já foi resolvida acima, não depende mais disso.
  if (bandidoMorrendoAction && mixerBandidoAnimado) {
    bandidoMorrendoAction.reset();
    bandidoMorrendoAction.play();
  } else {
    console.warn('Bandido sem animação de morte carregada - sumiu direto mesmo assim.');
  }

  verificarMissaoConcluida();
}

// Se os dois bandidos já foram neutralizados, a missão foi concluída com
// sucesso - manda o resultado pro servidor (só uma vez por sessão).
function verificarMissaoConcluida() {
  if (!bandidoVivo && !bandido2Vivo && modoCombateAtivo) {
    finalizarSessaoDeCombate('sobreviveu');
  }
}

// --- Segundo bandido: fica parado até você AVISTAR ele (não o contrário) ---
// Diferente do primeiro (que atira em você por distância/linha de visão),
// esse aqui só reage quando VOCÊ olha na direção dele com visão livre -
// nesse momento toca a animação "virando" uma única vez (ele te vendo e
// virando de surpresa).
let bandido2Objeto = null;
let mixerBandido2Animado = null;
let bandido2VirandoAction = null;
let bandido2Vivo = false;
let bandido2AnimadoPendente = null;
let bandido2JaTocouVirando = false;

// Posição do segundo bandido em coordenadas de MUNDO (mesmo esquema do
// primeiro - use o painel verde de debug X/Y/Z pra achar o ponto certo e
// troque esse valor de placeholder pela posição real que você quer).
const BANDIDO2_POSICAO_MUNDO = new THREE.Vector3(56.6, 3.13, -10.47);

function posicionarBandido2NoMundo() {
  if (!bandido2Objeto || !bandido2Objeto.parent) return;
  const local = BANDIDO2_POSICAO_MUNDO.clone();
  bandido2Objeto.parent.worldToLocal(local);
  bandido2Objeto.position.copy(local);
}

loader.load(
  '/virandotiro.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    bandido2Objeto = model;
    mixerBandido2Animado = new THREE.AnimationMixer(model);

    const clipVirando = gltf.animations.find((c) => c.name === 'virando');
    if (clipVirando) {
      bandido2VirandoAction = mixerBandido2Animado.clipAction(clipVirando);
      bandido2VirandoAction.setLoop(THREE.LoopOnce);
      bandido2VirandoAction.clampWhenFinished = true;
    } else {
      console.warn('Não achei a animação "virando" do segundo bandido.');
    }

    bandido2Vivo = true;

    if (casaModel) {
      casaModel.add(model);
      posicionarBandido2NoMundo();
      console.log('Segundo bandido encaixado na casa.');
    } else {
      bandido2AnimadoPendente = model;
    }

    console.log('Segundo bandido carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o segundo bandido (virandotiro.glb):', error);
  }
);

function acertarBandido2() {
  if (!bandido2Vivo) return;
  bandido2Vivo = false;
  tirosCertos += 1;
  justificativasDeUsoDaForca.push({
    alvo: 'bandido_2',
    motivo: 'ameaca_armada',
    descricao: 'Ameaça armada - suspeito em confronto ativo',
    timestamp: new Date().toISOString(),
  });
  registrarEventoDeSessao('evento_missao', 'Ameaça neutralizada (suspeito 2)', false);

  tocarSomDeTiroNoBandido();

  if (bandido2Objeto) bandido2Objeto.visible = false;
  console.log('Segundo bandido acertado!');

  verificarMissaoConcluida();
}

let mixerBondinho = null;
let bondinhoAction = null;
let bondinhoPendente = null;

loader.load(
  '/bondinho.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      console.log('Bondinho encaixado na casa.');
    } else {
      bondinhoPendente = model;
    }

    const clip = gltf.animations.find((c) => c.name === 'bondeandando');
    if (clip) {
      mixerBondinho = new THREE.AnimationMixer(model);
      bondinhoAction = mixerBondinho.clipAction(clip);
      bondinhoAction.setLoop(THREE.LoopOnce);
      bondinhoAction.clampWhenFinished = true;
      bondinhoAction.play();
      bondinhoAction.paused = true;
      bondinhoAction.time = 0;
      mixerBondinho.update(0);
    } else {
      console.warn('Não achei a animação "bondeandando" no bondinho.glb. Animações disponíveis:', gltf.animations.map((c) => c.name));
    }

    console.log('Bondinho carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o bondinho:', error);
  }
);

let mixerBus = null;
let busAction = null;
let busPendente = null;

loader.load(
  '/bus.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      console.log('Ônibus encaixado na casa.');
    } else {
      busPendente = model;
    }

    const clip = gltf.animations.find((c) => c.name === 'onibusandando');
    if (clip) {
      mixerBus = new THREE.AnimationMixer(model);
      busAction = mixerBus.clipAction(clip);
      busAction.setLoop(THREE.LoopRepeat, Infinity); // toca pra sempre, em loop
      busAction.play();
    } else {
      console.warn('Não achei a animação "onibusandando" no bus.glb. Animações disponíveis:', gltf.animations.map((c) => c.name));
    }

    console.log('Ônibus carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o ônibus:', error);
  }
);

let bodycamPendente = null;
let bodycamObjeto = null;

loader.load(
  '/bodycam.glb',
  (gltf) => {
    const model = gltf.scene;
    model.name = 'Pegavel_Bodycam';
    bodycamObjeto = model;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      objetosPegaveis.push(model);
      console.log('Bodycam encaixada na casa e registrada como pegável.');
    } else {
      bodycamPendente = model;
    }

    console.log('Bodycam carregada com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a bodycam:', error);
  }
);

let postesPendente = null;

loader.load(
  '/postes.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      console.log('Postes encaixados na casa.');
    } else {
      postesPendente = model;
    }

    console.log('Postes carregados com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar os postes:', error);
  }
);

let barricadaPendente = null;

loader.load(
  '/barricada.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      console.log('Barricada encaixada na casa.');
    } else {
      barricadaPendente = model;
    }

    console.log('Barricada carregada com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a barricada:', error);
  }
);

let casasPendente = null;

loader.load(
  '/casas.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      criarColisorDaCasa(model);
      console.log('Casas encaixadas na cena e colisor criado.');
    } else {
      casasPendente = model;
    }

    console.log('Casas carregadas com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar as casas:', error);
  }
);

// Spawn4: um Empty que marca o destino de quando clicar no bodycam.
let spawnPoint4Position = null;

loader.load(
  '/spawn4.glb',
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    const spawnNode = model.getObjectByName('Spawn4') || model;
    spawnPoint4Position = new THREE.Vector3();
    spawnNode.getWorldPosition(spawnPoint4Position);
    console.log('Spawn4 encontrado! Destino do bodycam:', spawnPoint4Position);
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o spawn4.glb:', error);
  }
);

let paredaoPendente = null;

loader.load(
  '/paredao.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      criarColisorDaCasa(model);
      console.log('Paredão encaixado na cena e colisor criado.');
    } else {
      paredaoPendente = model;
    }

    console.log('Paredão carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o paredão:', error);
  }
);

// Arquivo separado só com cubos de bloqueio (não é exibido na cena, só usado
// pra gerar colisão invisível). Cada cubo dentro dele precisa começar com "Bloqueio_".
loader.load(
  '/bloqueio.glb',
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    const bloqueios = [];
    model.traverse((child) => {
      if (child.name && child.name.startsWith('Bloqueio_')) {
        bloqueios.push(child);
      }
    });

    bloqueios.forEach((cubo) => {
      const caixa = new THREE.Box3().setFromObject(cubo);
      const centro = new THREE.Vector3();
      const tamanho = new THREE.Vector3();
      caixa.getCenter(centro);
      caixa.getSize(tamanho);
      criarBloqueioInvisivel(centro.x, centro.y, centro.z, tamanho.x, tamanho.y, tamanho.z);
    });

    if (bloqueios.length > 0) {
      console.log(`${bloqueios.length} bloqueio(s) invisível(is) criado(s) a partir de bloqueio.glb.`);
    } else {
      console.warn('Nenhum cubo "Bloqueio_*" encontrado dentro de bloqueio.glb.');
    }
    // Não adicionamos o model na cena de propósito: ele é só um marcador de colisão, invisível sempre.
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o bloqueio.glb:', error);
  }
);

let trilhoPendente = null;

loader.load(
  '/trilho.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      console.log('Trilho encaixado na casa.');
    } else {
      trilhoPendente = model;
    }

    console.log('Trilho carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o trilho:', error);
  }
);

let cenarioPendente = null;

loader.load(
  '/cenario.glb',
  (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
      }
    });

    if (casaModel) {
      casaModel.add(model);
      console.log('Cenario encaixado na casa.');
    } else {
      cenarioPendente = model;
    }

    console.log('Cenario carregado com sucesso!');
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o cenario:', error);
  }
);

const BONDINHO_DELAY_MS = 9000; // ajuste aqui o tempo de espera (em milissegundos)

function tocarAnimacaoDoBondinho() {
  if (!bondinhoAction) return;
  setTimeout(() => {
    bondinhoAction.paused = false;
    bondinhoAction.timeScale = 1;
    bondinhoAction.reset();
    bondinhoAction.play();
  }, BONDINHO_DELAY_MS);
}

function tocarVideoDaTela() {
  videoElemento.currentTime = 0;
  videoElemento.play().catch((erro) => {
    console.warn('Não consegui tocar o vídeo automaticamente:', erro);
  });
}

const somCarro = new THREE.Audio(audioListener);
audioLoader.load('/audiocarro.mp3', (buffer) => {
  somCarro.setBuffer(buffer);
  somCarro.setVolume(0.7);
});

function tocarSomDoCarro() {
  if (somCarro.isPlaying) somCarro.stop();
  somCarro.play();
}

let testeDanoDiretoTimeoutId = null; // TESTE: ver comentário dentro de verificarInteracaoElevador

function verificarInteracaoElevador(controller) {
  if (!elevadorObjeto || !spawnPoint2Position) return;

  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  const intersects = raycaster.intersectObject(elevadorObjeto, true);
  if (intersects.length > 0) {
    console.log('Elevador clicado! Teleportando para o SpawnPoint2...');
    definirPosicaoFisicaDoJogador(spawnPoint2Position.x, spawnPoint2Position.y, spawnPoint2Position.z);
    tocarAnimacaoDoCarroBope();
    tocarVideoDaTela();
    tocarSomDoCarro();
    tocarAnimacaoDoBondinho();

    // A arma também aparece ao entrar no carro do BOPE, não só quando o totem libera o treino.
    if (gunModel) gunModel.visible = true;
    if (controllerModel1) controllerModel1.visible = false;

    // Liga o modo combate: barra de vida + bandido atirando de verdade.
    // Independente do jogo de alvos do totem (jogoAtivo).
    modoCombateAtivo = true;
    restaurarVida();
    iniciarTiroDoBandido();
    iniciarComandoDeVoz();
    iniciarAnaliseDeVoz();
    iniciarSessaoDeMonitoramento();
    hudPlano.position.copy(HUD_POSICAO_CANTO);
    hudPlano.scale.set(1, 1, 1);
    hudPlano.visible = true;
    clearTimeout(hudEsconderTimeoutId);
    desenharHUD();

    // Cartela de briefing da missão, ao entrar em combate (elevador).
    mostrarBriefing('MISSÃO', 'Neutralize as ameaças e encontre a droga escondida.');

    // TESTE: dispara uma sequência de fogos de artifício na posição de
    // teste, só pra você ver o efeito funcionando. Quando me passar a
    // posição certa (via log [POS] no console), eu atualizo
    // FOGOS_ARTIFICIO_POSICAO_TESTE e podemos decidir o gatilho definitivo
    // (ex: só na tela de vitória, não aqui no início).
    setTimeout(() => criarFogoDeArtificio(FOGOS_ARTIFICIO_POSICAO_TESTE), 1000);
    setTimeout(() => criarFogoDeArtificio(FOGOS_ARTIFICIO_POSICAO_TESTE.clone().add(new THREE.Vector3(0.8, 0.3, 0))), 1400);
    setTimeout(() => criarFogoDeArtificio(FOGOS_ARTIFICIO_POSICAO_TESTE.clone().add(new THREE.Vector3(-0.7, -0.2, 0.4))), 1800);

    // TESTE: dispara o efeito de "levar tiro" direto (10s depois de entrar
    // no carro), sem depender do bandido/distância/linha de visão. É só pra
    // confirmar que o atraso + vinheta + som + cartela funcionam certinho.
    // Quando não precisar mais testar isso, é só apagar este bloco.
    clearTimeout(testeDanoDiretoTimeoutId);
    testeDanoDiretoTimeoutId = setTimeout(() => {
      if (!modoCombateAtivo) return;
      console.log('[TESTE] Disparando receberDano() direto, sem depender do bandido.');
      receberDano(BANDIDO_TIRO_DANO);
    }, 10000);
  }
}

function verificarCliqueNoBodycam(controller) {
  if (!bodycamObjeto) return;

  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  const intersects = raycaster.intersectObject(bodycamObjeto, true);
  if (intersects.length === 0) return; // nem acertou o bodycam - sem vibração nenhuma

  if (!spawnPoint4Position) {
    vibrarControle(controller, 1.0, 100); // TESTE: buzz curto = achou o bodycam, mas falta o Spawn4
    console.warn('Bodycam clicada, mas o Spawn4 ainda não foi encontrado/carregado.');
    return;
  }

  vibrarControle(controller, 1.0, 300); // TESTE: buzz longo = achou tudo e teleportou de verdade
  console.log('Bodycam clicada! Teleportando para o Spawn4...');
  definirPosicaoFisicaDoJogador(spawnPoint4Position.x, spawnPoint4Position.y, spawnPoint4Position.z);
}

let score = 0;

// --- Sistema de vida (energia) do jogador ---
// Esse sistema é independente do jogo de alvos do totem: ele liga quando
// você entra no carro do BOPE (elevador), não quando clica no totem.
const VIDA_MAXIMA = 100;
let vidaJogador = VIDA_MAXIMA;
let jogadorMorto = false;
let modoCombateAtivo = false;

const DURACAO_JOGO_SEGUNDOS = 60;
let jogoAtivo = false;
let jogoJaTerminou = false;
let tempoRestante = 0;
let timerIntervalId = null;

const hudCanvas = document.createElement('canvas');
hudCanvas.width = 256;
hudCanvas.height = 128;
const hudCtx = hudCanvas.getContext('2d');
const hudTexture = new THREE.CanvasTexture(hudCanvas);

function desenharHUD() {
  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  hudCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  hudCtx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  hudCtx.fillStyle = '#ffffff';
  hudCtx.textAlign = 'center';
  hudCtx.textBaseline = 'middle';

  if (modoCombateAtivo) {
    // Barra de vida/energia (só aparece no modo combate, ligado pelo carro do BOPE)
    const barraX = 10;
    const barraY = 6;
    const barraLargura = hudCanvas.width - 20;
    const barraAltura = 14;
    const vidaPercentual = Math.max(0, vidaJogador) / VIDA_MAXIMA;

    hudCtx.fillStyle = '#3a0000';
    hudCtx.fillRect(barraX, barraY, barraLargura, barraAltura);

    const corVida = vidaPercentual > 0.5 ? '#2e7d32' : vidaPercentual > 0.25 ? '#f9a825' : '#c62828';
    hudCtx.fillStyle = corVida;
    hudCtx.fillRect(barraX, barraY, barraLargura * vidaPercentual, barraAltura);

    hudCtx.strokeStyle = '#ffffff';
    hudCtx.lineWidth = 2;
    hudCtx.strokeRect(barraX, barraY, barraLargura, barraAltura);
    hudCtx.fillStyle = '#ffffff';

    // Contador de munição, embaixo da barra de vida.
    hudCtx.font = 'bold 20px monospace';
    hudCtx.fillStyle = recarregando ? '#f9a825' : '#ffffff';
    const textoMunicao = recarregando ? 'RECARREGANDO...' : `${municaoAtual} / ${MUNICAO_CAPACIDADE}`;
    hudCtx.fillText(textoMunicao, hudCanvas.width / 2, barraY + barraAltura + 18);
  }

  if (jogoAtivo) {
    hudCtx.font = 'bold 36px sans-serif';
    hudCtx.fillText(`Score: ${score}`, hudCanvas.width / 2, hudCanvas.height / 2 - 22);
    hudCtx.font = 'bold 30px sans-serif';
    hudCtx.fillText(`Tempo: ${tempoRestante}s`, hudCanvas.width / 2, hudCanvas.height / 2 + 26);

    hudCtx.font = 'bold 18px monospace';
    hudCtx.fillStyle = recarregando ? '#f9a825' : '#ffffff';
    const textoMunicaoTotem = recarregando ? 'RECARREGANDO...' : `${municaoAtual} / ${MUNICAO_CAPACIDADE}`;
    hudCtx.fillText(textoMunicaoTotem, hudCanvas.width / 2, hudCanvas.height - 10);
  } else if (jogoJaTerminou) {
    hudCtx.font = 'bold 26px sans-serif';
    hudCtx.fillText('Fim de jogo!', hudCanvas.width / 2, hudCanvas.height / 2 - 24);
    hudCtx.font = 'bold 34px sans-serif';
    hudCtx.fillText(`Score: ${score}`, hudCanvas.width / 2, hudCanvas.height / 2 + 22);
  } else {
    hudCtx.font = 'bold 44px sans-serif';
    hudCtx.fillText(`Score: ${score}`, hudCanvas.width / 2, hudCanvas.height / 2);
  }

  hudTexture.needsUpdate = true;
}
desenharHUD();

// --- Vinheta vermelha de dano (efeito "levei tiro", tipo FPS) ---
// Um plano preso à câmera, grande o bastante pra cobrir o campo de visão,
// com uma textura de gradiente radial (transparente no centro, vermelho nas
// bordas). A intensidade sobe na hora do dano e decai suavemente a cada frame.
const vinhetaCanvas = document.createElement('canvas');
vinhetaCanvas.width = 512;
vinhetaCanvas.height = 512;
const vinhetaCtx = vinhetaCanvas.getContext('2d');
// Raios pequenos de propósito: o campo de visão real do Quest só "enxerga"
// uma fração central desse canvas (o resto fica fora da sua visão). Se o
// vermelho começar longe do centro, ele nunca aparece de verdade pro
// jogador - por isso o gradiente começa a ficar visível bem cedo (perto
// do centro) e vai ficando bem forte antes mesmo da borda do canvas.
const vinhetaGradiente = vinhetaCtx.createRadialGradient(256, 256, 30, 256, 256, 256);
vinhetaGradiente.addColorStop(0, 'rgba(200, 0, 0, 0)');
vinhetaGradiente.addColorStop(0.45, 'rgba(190, 0, 0, 0.45)');
vinhetaGradiente.addColorStop(1, 'rgba(140, 0, 0, 0.9)');
vinhetaCtx.fillStyle = vinhetaGradiente;
vinhetaCtx.fillRect(0, 0, vinhetaCanvas.width, vinhetaCanvas.height);
const vinhetaTexture = new THREE.CanvasTexture(vinhetaCanvas);

const vinhetaMaterial = new THREE.MeshBasicMaterial({
  map: vinhetaTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
});
// Plano preso à câmera, cobrindo o campo de visão inteiro.
const vinhetaPlano = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), vinhetaMaterial);
vinhetaPlano.position.set(0, 0, -1);
vinhetaPlano.renderOrder = 1000; // desenha por cima do HUD
vinhetaPlano.visible = false;
camera.add(vinhetaPlano);

// Duração total do flash vermelho (fica visível e depois some suavemente).
const DANO_FLASH_DURACAO_MS = 600;
const DANO_FLASH_FADEOUT_SEGUNDOS = 0.6; // quanto tempo leva pra sumir suavemente no final
let danoFlashTempoRestanteMs = 0;

function piscarDano() {
  danoFlashTempoRestanteMs = DANO_FLASH_DURACAO_MS;
  vinhetaMaterial.opacity = 1;
  vinhetaPlano.visible = true;
}

// Chamado a cada frame (no loop de animação) pra atualizar o fade da vinheta.
function atualizarVinhetaDeDano(delta) {
  if (danoFlashTempoRestanteMs <= 0) return;
  danoFlashTempoRestanteMs -= delta * 1000;

  const fadeoutMs = DANO_FLASH_FADEOUT_SEGUNDOS * 1000;
  if (danoFlashTempoRestanteMs <= fadeoutMs) {
    vinhetaMaterial.opacity = Math.max(0, danoFlashTempoRestanteMs / fadeoutMs);
  }

  if (danoFlashTempoRestanteMs <= 0) {
    vinhetaPlano.visible = false;
  }
}

// --- Aviso central de texto (ex: "Você levou um tiro! Proteja-se na barricada!") ---
// Um plano preso à câmera, centralizado, com uma faixa vermelha e o texto
// desenhado num canvas (igual o HUD, mas maior e mais chamativo).
const avisoCanvas = document.createElement('canvas');
avisoCanvas.width = 1024;
avisoCanvas.height = 300;
const avisoCtx = avisoCanvas.getContext('2d');
const avisoTexture = new THREE.CanvasTexture(avisoCanvas);

function desenharAviso(linha1, linha2) {
  avisoCtx.clearRect(0, 0, avisoCanvas.width, avisoCanvas.height);

  // Faixa de fundo vermelha escura, com borda
  avisoCtx.fillStyle = 'rgba(120, 0, 0, 0.85)';
  avisoCtx.fillRect(0, 0, avisoCanvas.width, avisoCanvas.height);
  avisoCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  avisoCtx.lineWidth = 6;
  avisoCtx.strokeRect(6, 6, avisoCanvas.width - 12, avisoCanvas.height - 12);

  avisoCtx.textAlign = 'center';
  avisoCtx.textBaseline = 'middle';
  avisoCtx.fillStyle = '#ffffff';

  avisoCtx.font = 'bold 72px sans-serif';
  avisoCtx.fillText(linha1, avisoCanvas.width / 2, avisoCanvas.height / 2 - 55);

  avisoCtx.font = 'bold 52px sans-serif';
  avisoCtx.fillStyle = '#ffe082';
  avisoCtx.fillText(linha2, avisoCanvas.width / 2, avisoCanvas.height / 2 + 55);

  avisoTexture.needsUpdate = true;
}

const avisoMaterial = new THREE.MeshBasicMaterial({
  map: avisoTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
});
const avisoPlano = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.32), avisoMaterial);
avisoPlano.position.set(0, 0.1, -0.9); // mais perto do centro da visão
avisoPlano.renderOrder = 1001; // por cima de tudo, inclusive da vinheta
avisoPlano.visible = false;
camera.add(avisoPlano);

const AVISO_DURACAO_MS = 3000; // quanto tempo fica totalmente visível
const AVISO_FADEOUT_SEGUNDOS = 0.6; // quanto tempo leva pra sumir suavemente
let avisoTempoRestanteMs = 0;

function mostrarAviso(linha1, linha2 = '') {
  desenharAviso(linha1, linha2);
  avisoPlano.visible = true;
  avisoMaterial.opacity = 1;
  avisoTempoRestanteMs = AVISO_DURACAO_MS;
}

// Chamado a cada frame no loop de animação, igual a vinheta de dano.
function atualizarAviso(delta) {
  if (avisoTempoRestanteMs <= 0) return;
  avisoTempoRestanteMs -= delta * 1000;

  const fadeoutMs = AVISO_FADEOUT_SEGUNDOS * 1000;
  if (avisoTempoRestanteMs <= fadeoutMs) {
    avisoMaterial.opacity = Math.max(0, avisoTempoRestanteMs / fadeoutMs);
  }

  if (avisoTempoRestanteMs <= 0) {
    avisoPlano.visible = false;
  }
}

// --- Painel de briefing de missão (separado do aviso de "levou tiro") ---
// Quadrado, visual mais "tático" (cantos marcados, faixa de título em
// destaque), fica mais tempo na tela, e já preparado pra desenhar uma
// logo no topo se você mandar um arquivo de imagem.
const briefingCanvas = document.createElement('canvas');
briefingCanvas.width = 640;
briefingCanvas.height = 640;
const briefingCtx = briefingCanvas.getContext('2d');
const briefingTexture = new THREE.CanvasTexture(briefingCanvas);

// Logo opcional - se o arquivo não existir/carregar, o painel simplesmente
// não desenha essa parte (sem quebrar nada). Troque '/logo-missao.png' pelo nome
// real do arquivo quando você mandar a imagem.
const briefingLogoImagem = new Image();
let briefingLogoCarregada = false;
briefingLogoImagem.onload = () => {
  briefingLogoCarregada = true;
  console.log('[DEBUG briefing] Logo carregada com sucesso.');
};
briefingLogoImagem.onerror = () => {
  console.warn('[DEBUG briefing] Logo não encontrada (logo.png) - painel vai funcionar normal, só sem a imagem.');
};
briefingLogoImagem.src = '/logo-missao.png';

// Quebra o texto em várias linhas pra caber na largura do painel.
function quebrarTexto(ctx, texto, larguraMax) {
  const palavras = texto.split(' ');
  const linhas = [];
  let linhaAtual = '';

  for (const palavra of palavras) {
    const tentativa = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
    if (ctx.measureText(tentativa).width > larguraMax && linhaAtual) {
      linhas.push(linhaAtual);
      linhaAtual = palavra;
    } else {
      linhaAtual = tentativa;
    }
  }
  if (linhaAtual) linhas.push(linhaAtual);
  return linhas;
}

function desenharBriefing(titulo, descricao) {
  const w = briefingCanvas.width;
  const h = briefingCanvas.height;
  briefingCtx.clearRect(0, 0, w, h);

  // Fundo escuro tático, com borda dupla.
  briefingCtx.fillStyle = 'rgba(10, 14, 10, 0.92)';
  briefingCtx.fillRect(0, 0, w, h);
  briefingCtx.strokeStyle = '#c9a227'; // dourado/âmbar, tipo insígnia policial
  briefingCtx.lineWidth = 6;
  briefingCtx.strokeRect(10, 10, w - 20, h - 20);
  briefingCtx.lineWidth = 2;
  briefingCtx.strokeStyle = 'rgba(201, 162, 39, 0.5)';
  briefingCtx.strokeRect(22, 22, w - 44, h - 44);

  let cursorY = 60;

  // Logo, se estiver carregada, centralizada no topo - respeitando a
  // proporção real da imagem (não força quadrado, senão distorce).
  if (briefingLogoCarregada) {
    const larguraMaxima = w - 160; // margem das bordas
    const alturaMaxima = 160;
    const proporcao = briefingLogoImagem.naturalWidth / briefingLogoImagem.naturalHeight;

    let logoLargura = larguraMaxima;
    let logoAltura = logoLargura / proporcao;
    if (logoAltura > alturaMaxima) {
      logoAltura = alturaMaxima;
      logoLargura = logoAltura * proporcao;
    }

    briefingCtx.drawImage(briefingLogoImagem, w / 2 - logoLargura / 2, cursorY, logoLargura, logoAltura);
    cursorY += logoAltura + 30;
  } else {
    cursorY += 20;
  }

  // Título (ex: "MISSÃO"), em destaque.
  briefingCtx.textAlign = 'center';
  briefingCtx.fillStyle = '#c9a227';
  briefingCtx.font = 'bold 54px sans-serif';
  briefingCtx.fillText(titulo, w / 2, cursorY + 30);
  cursorY += 70;

  // Linha separadora fina embaixo do título.
  briefingCtx.strokeStyle = 'rgba(201, 162, 39, 0.6)';
  briefingCtx.lineWidth = 2;
  briefingCtx.beginPath();
  briefingCtx.moveTo(w * 0.2, cursorY);
  briefingCtx.lineTo(w * 0.8, cursorY);
  briefingCtx.stroke();
  cursorY += 50;

  // Descrição, quebrada em várias linhas, centralizada.
  briefingCtx.fillStyle = '#ffffff';
  briefingCtx.font = '32px sans-serif';
  const linhas = quebrarTexto(briefingCtx, descricao, w - 100);
  for (const linha of linhas) {
    briefingCtx.fillText(linha, w / 2, cursorY);
    cursorY += 42;
  }

  briefingTexture.needsUpdate = true;
}

const briefingMaterial = new THREE.MeshBasicMaterial({
  map: briefingTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
});
const briefingPlano = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), briefingMaterial); // quadrado
briefingPlano.position.set(0, 0.05, -0.9);
briefingPlano.renderOrder = 1001;
briefingPlano.visible = false;
camera.add(briefingPlano);

const BRIEFING_DURACAO_MS = 7000; // bem mais tempo que o aviso normal (3s)
const BRIEFING_FADEOUT_SEGUNDOS = 0.8;
let briefingTempoRestanteMs = 0;

function mostrarBriefing(titulo, descricao) {
  desenharBriefing(titulo, descricao);
  briefingPlano.visible = true;
  briefingMaterial.opacity = 1;
  briefingTempoRestanteMs = BRIEFING_DURACAO_MS;
}

function atualizarBriefing(delta) {
  if (briefingTempoRestanteMs <= 0) return;
  briefingTempoRestanteMs -= delta * 1000;

  const fadeoutMs = BRIEFING_FADEOUT_SEGUNDOS * 1000;
  if (briefingTempoRestanteMs <= fadeoutMs) {
    briefingMaterial.opacity = Math.max(0, briefingTempoRestanteMs / fadeoutMs);
  }

  if (briefingTempoRestanteMs <= 0) {
    briefingPlano.visible = false;
  }
}

// --- Interface de Bodycam ---
// Uma moldura de câmera presa na visão (tipo gravação de câmera corporal
// policial de verdade): cantos de enquadramento, "● REC" piscando com
// cronômetro, data/hora, e identificação do dispositivo. O centro da
// visão fica praticamente livre (só a moldura nas bordas), pra não
// atrapalhar a mira. Liga/desliga com o clique do analógico esquerdo.
const bodycamCanvas = document.createElement('canvas');
bodycamCanvas.width = 1024;
bodycamCanvas.height = 1024;
const bodycamCtx = bodycamCanvas.getContext('2d');
const bodycamTexture = new THREE.CanvasTexture(bodycamCanvas);

const bodycamMaterial = new THREE.MeshBasicMaterial({
  map: bodycamTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const bodycamPlano = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), bodycamMaterial);
bodycamPlano.position.set(0, 0, -1.05); // cobre bem o campo de visão
bodycamPlano.renderOrder = 998; // atrás da vinheta/aviso/briefing, na frente do resto
bodycamPlano.visible = false;
camera.add(bodycamPlano);

let bodycamAtiva = false;
let bodycamSegundosGravando = 0;
let bodycamPiscaAcumulador = 0;
let bodycamPiscaVisivel = true;

function desenharBodycam() {
  const w = bodycamCanvas.width;
  const h = bodycamCanvas.height;
  bodycamCtx.clearRect(0, 0, w, h);

  // Moldura fina nas bordas (área "de enquadramento" da câmera).
  const margem = 40;
  bodycamCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  bodycamCtx.lineWidth = 2;
  bodycamCtx.strokeRect(margem, margem, w - margem * 2, h - margem * 2);

  // Cantos estilo "viewfinder" (câmera de verdade).
  const cantoTam = 34;
  bodycamCtx.lineWidth = 4;
  bodycamCtx.strokeStyle = '#ffffff';
  const cantos = [
    [margem, margem, 1, 1],
    [w - margem, margem, -1, 1],
    [margem, h - margem, 1, -1],
    [w - margem, h - margem, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of cantos) {
    bodycamCtx.beginPath();
    bodycamCtx.moveTo(cx, cy + cantoTam * dy);
    bodycamCtx.lineTo(cx, cy);
    bodycamCtx.lineTo(cx + cantoTam * dx, cy);
    bodycamCtx.stroke();
  }

  bodycamCtx.textBaseline = 'middle';
  bodycamCtx.fillStyle = '#ffffff';
  bodycamCtx.font = 'bold 30px monospace';

  // REC piscando + cronômetro, canto superior esquerdo.
  bodycamCtx.textAlign = 'left';
  if (bodycamPiscaVisivel) {
    bodycamCtx.fillStyle = '#ff3b30';
    bodycamCtx.beginPath();
    bodycamCtx.arc(margem + 28, margem + 40, 12, 0, Math.PI * 2);
    bodycamCtx.fill();
  }
  bodycamCtx.fillStyle = '#ffffff';
  bodycamCtx.font = 'bold 28px monospace';
  bodycamCtx.fillText('REC', margem + 52, margem + 40);

  const minutos = Math.floor(bodycamSegundosGravando / 60).toString().padStart(2, '0');
  const segundos = Math.floor(bodycamSegundosGravando % 60).toString().padStart(2, '0');
  bodycamCtx.font = '26px monospace';
  bodycamCtx.fillText(`${minutos}:${segundos}`, margem + 150, margem + 40);

  // Data/hora real, canto superior direito.
  bodycamCtx.textAlign = 'right';
  const agora = new Date();
  const dataHora = agora.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  bodycamCtx.font = '24px monospace';
  bodycamCtx.fillText(dataHora, w - margem - 10, margem + 40);

  // Identificação do dispositivo, canto inferior esquerdo.
  bodycamCtx.textAlign = 'left';
  bodycamCtx.font = 'bold 24px monospace';
  bodycamCtx.fillText('BODYCAM 01', margem + 10, h - margem - 30);
  bodycamCtx.font = '20px monospace';
  bodycamCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  bodycamCtx.fillText('XPTO INC.', margem + 10, h - margem);

  // Bateria (fake, só decorativo), canto inferior direito.
  bodycamCtx.textAlign = 'right';
  bodycamCtx.fillStyle = '#ffffff';
  bodycamCtx.font = '22px monospace';
  bodycamCtx.fillText('BAT 87%', w - margem - 10, h - margem);

  bodycamTexture.needsUpdate = true;
}

function ligarDesligarBodycam() {
  bodycamAtiva = !bodycamAtiva;
  bodycamPlano.visible = bodycamAtiva;
  if (bodycamAtiva) {
    bodycamSegundosGravando = 0;
    desenharBodycam();
    console.log('[Bodycam] Gravação iniciada.');
    registrarEventoDeSessao('bodycam_ativada', 'Bodycam ativada', true);
  } else {
    console.log('[Bodycam] Gravação encerrada.');
    registrarEventoDeSessao('bodycam_desativada', 'Bodycam desativada', true);
  }
}

function atualizarBodycam(delta) {
  if (!bodycamAtiva) return;

  bodycamSegundosGravando += delta;

  // Pisca o "REC" 2x por segundo, e só redesenha o canvas nesse ritmo
  // (não every frame) - leve o suficiente pra não pesar.
  bodycamPiscaAcumulador += delta;
  if (bodycamPiscaAcumulador >= 0.5) {
    bodycamPiscaAcumulador = 0;
    bodycamPiscaVisivel = !bodycamPiscaVisivel;
    desenharBodycam();
  }
}

// --- Captura de evidência (foto) ---
// Guarda as capturas em memória por enquanto (o envio pro servidor entra
// depois que o Vercel Blob estiver configurado). Cada captura vira um
// dataURL (PNG) + um hash SHA-256 real da imagem, calculado de verdade
// via Web Crypto API - não é decoração, é o hash genuíno daquele arquivo.
const evidenciasCapturadas = [];

// Flash branco na captura, tipo câmera de verdade - plano grande preso na
// câmera, igual a vinheta de dano, só que branco e bem mais rápido.
const flashCapturaMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
});
const flashCapturaPlano = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), flashCapturaMaterial);
flashCapturaPlano.position.set(0, 0, -1);
flashCapturaPlano.renderOrder = 1003; // por cima de tudo, inclusive da evidência
flashCapturaPlano.visible = false;
camera.add(flashCapturaPlano);

const FLASH_CAPTURA_DURACAO_MS = 180;
let flashCapturaTempoRestanteMs = 0;

function piscarFlashDeCaptura() {
  flashCapturaMaterial.opacity = 1;
  flashCapturaPlano.visible = true;
  flashCapturaTempoRestanteMs = FLASH_CAPTURA_DURACAO_MS;
}

function atualizarFlashDeCaptura(delta) {
  if (flashCapturaTempoRestanteMs <= 0) return;
  flashCapturaTempoRestanteMs -= delta * 1000;
  flashCapturaMaterial.opacity = Math.max(0, flashCapturaTempoRestanteMs / FLASH_CAPTURA_DURACAO_MS);
  if (flashCapturaTempoRestanteMs <= 0) {
    flashCapturaPlano.visible = false;
  }
}

// Som de obturador de câmera, gerado por código (2 cliques rápidos em
// sequência). Troque por um arquivo de áudio de verdade depois, se quiser.
function tocarSomDeCaptura() {
  if (sfxAudioCtx.state === 'suspended') sfxAudioCtx.resume();

  const tocarClique = (atrasoSegundos, frequencia) => {
    const agora = sfxAudioCtx.currentTime + atrasoSegundos;
    const oscillator = sfxAudioCtx.createOscillator();
    const gainNode = sfxAudioCtx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequencia, agora);
    gainNode.gain.setValueAtTime(0.3, agora);
    gainNode.gain.exponentialRampToValueAtTime(0.001, agora + 0.04);
    oscillator.connect(gainNode);
    gainNode.connect(sfxAudioCtx.destination);
    oscillator.start(agora);
    oscillator.stop(agora + 0.04);
  };

  tocarClique(0, 900);
  tocarClique(0.06, 1400);
}

function gerarIdEvidencia() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const aleatorio = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `EVD-${timestamp}-${aleatorio}`;
}

// Conversão manual de dataURL pra bytes - mais confiável entre navegadores
// do que usar fetch() num data: URL (que pode se comportar diferente
// dependendo do navegador/contexto do WebXR).
function dataURLParaArrayBuffer(dataURL) {
  const base64 = dataURL.split(',')[1];
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes.buffer;
}

async function calcularHashSHA256(dataURL) {
  if (!window.crypto?.subtle) {
    throw new Error('crypto.subtle indisponível - o site precisa estar em HTTPS (ou localhost) pra calcular hash.');
  }
  const buffer = dataURLParaArrayBuffer(dataURL);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Renderiza a cena numa textura separada (fora do "compositor" da sessão
// VR) e lê os pixels de lá - o jeito confiável de capturar imagem mesmo
// com o headset colocado, já que o navegador normalmente não espelha a
// imagem no canvas comum enquanto a sessão imersiva está ativa (por isso
// a captura direta saía preta).
let capturaRenderTarget = null;

function capturarFrameParaEvidencia() {
  const largura = 1024;
  const altura = 768;

  if (!capturaRenderTarget) {
    capturaRenderTarget = new THREE.WebGLRenderTarget(largura, altura);
  }

  const xrEstavaAtivo = renderer.xr.enabled;
  renderer.xr.enabled = false; // desvia o render do compositor da sessão VR por um instante

  renderer.setRenderTarget(capturaRenderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  renderer.xr.enabled = xrEstavaAtivo; // liga de volta na mesma hora

  const pixelBuffer = new Uint8Array(largura * altura * 4);
  renderer.readRenderTargetPixels(capturaRenderTarget, 0, 0, largura, altura, pixelBuffer);

  // Os pixels do WebGL vêm de baixo pra cima - precisa inverter as linhas
  // verticalmente pra imagem sair correta.
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(largura, altura);

  for (let y = 0; y < altura; y++) {
    const linhaOrigem = (altura - y - 1) * largura * 4;
    const linhaDestino = y * largura * 4;
    imageData.data.set(pixelBuffer.subarray(linhaOrigem, linhaOrigem + largura * 4), linhaDestino);
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

async function capturarEvidencia() {
  console.log('[Evidência] Botão de captura apertado, iniciando...');
  tocarSomDeCaptura();

  try {
    // Captura o frame ANTES de acender o flash - senão a "foto" sai toda
    // branca, porque captura o próprio flash cobrindo a visão. O flash
    // acende logo em seguida, só como feedback visual pro jogador.
    const dataURL = capturarFrameParaEvidencia();
    piscarFlashDeCaptura();
    const id = gerarIdEvidencia();
    const timestamp = new Date();

    mostrarPainelDeEvidenciaCarregando();

    const hash = await calcularHashSHA256(dataURL);

    evidenciasCapturadas.push({ id, dataURL, hash, timestamp });
    console.log(`[Evidência] Capturada com sucesso: ${id} | hash: ${hash}`);

    mostrarPainelDeEvidencia(id, hash, timestamp);

    // Aparece na linha do tempo da Central do Instrutor também, com a
    // posição de onde a captura foi feita.
    registrarEventoDeSessao('evidencia_capturada', `Evidência capturada · ${id}`, true);

    // Envia pro servidor (Vercel Blob) em segundo plano - não trava a
    // interface esperando o upload terminar.
    enviarEvidenciaParaServidor(id, hash, timestamp, dataURL);
  } catch (erro) {
    console.error('[Evidência] FALHOU ao capturar/calcular hash:', erro);
    mostrarPainelDeEvidenciaErro(erro.message);
  }
}

async function enviarEvidenciaParaServidor(id, hash, timestamp, dataURL) {
  try {
    const resposta = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        hash,
        timestamp: timestamp.toISOString(),
        imageBase64: dataURL,
        sessaoId: sessaoIdAtual,
      }),
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      throw new Error(`Servidor respondeu ${resposta.status}: ${erroTexto}`);
    }

    const resultado = await resposta.json();
    console.log(`[Evidência] Enviada pro servidor com sucesso: ${resultado.url}`);
  } catch (erro) {
    console.error('[Evidência] FALHOU ao enviar pro servidor (ficou salva só localmente):', erro);
  }
}

// Painel de verificação de evidência - visual "técnico/forense", mostra
// ID, hash SHA-256 (quebrado em 2 linhas, já que é longo) e timestamp.
const evidenciaCanvas = document.createElement('canvas');
evidenciaCanvas.width = 700;
evidenciaCanvas.height = 500;
const evidenciaCtx = evidenciaCanvas.getContext('2d');
const evidenciaTexture = new THREE.CanvasTexture(evidenciaCanvas);

const evidenciaMaterial = new THREE.MeshBasicMaterial({
  map: evidenciaTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
});
const evidenciaPlano = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.43), evidenciaMaterial);
evidenciaPlano.position.set(0, 0, -0.85);
evidenciaPlano.renderOrder = 1002;
evidenciaPlano.visible = false;
camera.add(evidenciaPlano);

function desenharFundoEvidencia() {
  const w = evidenciaCanvas.width;
  const h = evidenciaCanvas.height;
  evidenciaCtx.clearRect(0, 0, w, h);
  evidenciaCtx.fillStyle = 'rgba(8, 12, 18, 0.94)';
  evidenciaCtx.fillRect(0, 0, w, h);
  evidenciaCtx.strokeStyle = '#00e5ff';
  evidenciaCtx.lineWidth = 4;
  evidenciaCtx.strokeRect(8, 8, w - 16, h - 16);
}

function mostrarPainelDeEvidenciaCarregando() {
  desenharFundoEvidencia();
  const w = evidenciaCanvas.width;
  const h = evidenciaCanvas.height;

  evidenciaCtx.textAlign = 'center';
  evidenciaCtx.fillStyle = '#00e5ff';
  evidenciaCtx.font = 'bold 34px monospace';
  evidenciaCtx.fillText('CAPTURANDO EVIDÊNCIA...', w / 2, h / 2 - 10);
  evidenciaCtx.font = '22px monospace';
  evidenciaCtx.fillStyle = '#ffffff';
  evidenciaCtx.fillText('Calculando hash SHA-256', w / 2, h / 2 + 30);

  evidenciaTexture.needsUpdate = true;
  evidenciaMaterial.opacity = 1;
  evidenciaPlano.visible = true;
  evidenciaTempoRestanteMs = 0; // não conta tempo pra sumir ainda, só quando o resultado aparecer
}

function mostrarPainelDeEvidenciaErro(mensagemErro) {
  desenharFundoEvidencia();
  const w = evidenciaCanvas.width;
  const h = evidenciaCanvas.height;

  evidenciaCtx.textAlign = 'center';
  evidenciaCtx.fillStyle = '#ff3b30';
  evidenciaCtx.font = 'bold 32px monospace';
  evidenciaCtx.fillText('✕ FALHA NA CAPTURA', w / 2, h / 2 - 30);

  evidenciaCtx.fillStyle = '#ffffff';
  evidenciaCtx.font = '18px monospace';
  const linhas = mensagemErro.match(/.{1,45}/g) || [mensagemErro];
  linhas.forEach((linha, i) => {
    evidenciaCtx.fillText(linha, w / 2, h / 2 + 20 + i * 26);
  });

  evidenciaCtx.fillStyle = '#8899aa';
  evidenciaCtx.font = '16px monospace';
  evidenciaCtx.fillText('Veja o console (F12) para mais detalhes', w / 2, h / 2 + 130);

  evidenciaTexture.needsUpdate = true;
  evidenciaMaterial.opacity = 1;
  evidenciaPlano.visible = true;
  evidenciaTempoRestanteMs = EVIDENCIA_DURACAO_MS;
}

function mostrarPainelDeEvidencia(id, hash, timestamp) {
  desenharFundoEvidencia();
  const w = evidenciaCanvas.width;
  const h = evidenciaCanvas.height;

  evidenciaCtx.textAlign = 'left';
  evidenciaCtx.fillStyle = '#00e5ff';
  evidenciaCtx.font = 'bold 30px monospace';
  evidenciaCtx.fillText('✓ EVIDÊNCIA VERIFICADA', 30, 55);

  evidenciaCtx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
  evidenciaCtx.lineWidth = 2;
  evidenciaCtx.beginPath();
  evidenciaCtx.moveTo(30, 75);
  evidenciaCtx.lineTo(w - 30, 75);
  evidenciaCtx.stroke();

  evidenciaCtx.fillStyle = '#ffffff';
  evidenciaCtx.font = '20px monospace';

  evidenciaCtx.fillStyle = '#8899aa';
  evidenciaCtx.fillText('ID DA EVIDÊNCIA', 30, 115);
  evidenciaCtx.fillStyle = '#ffffff';
  evidenciaCtx.font = 'bold 24px monospace';
  evidenciaCtx.fillText(id, 30, 145);

  evidenciaCtx.fillStyle = '#8899aa';
  evidenciaCtx.font = '20px monospace';
  evidenciaCtx.fillText('DATA/HORA', 30, 190);
  evidenciaCtx.fillStyle = '#ffffff';
  evidenciaCtx.font = 'bold 22px monospace';
  evidenciaCtx.fillText(
    timestamp.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    30, 218
  );

  evidenciaCtx.fillStyle = '#8899aa';
  evidenciaCtx.font = '20px monospace';
  evidenciaCtx.fillText('HASH SHA-256', 30, 263);
  evidenciaCtx.fillStyle = '#00e5ff';
  evidenciaCtx.font = '18px monospace';
  // Quebra o hash em duas linhas (64 caracteres é longo demais pra 1 linha)
  evidenciaCtx.fillText(hash.slice(0, 32), 30, 290);
  evidenciaCtx.fillText(hash.slice(32), 30, 313);

  evidenciaCtx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
  evidenciaCtx.beginPath();
  evidenciaCtx.moveTo(30, 340);
  evidenciaCtx.lineTo(w - 30, 340);
  evidenciaCtx.stroke();

  evidenciaCtx.fillStyle = '#8899aa';
  evidenciaCtx.font = '17px monospace';
  evidenciaCtx.fillText('Cadeia de custódia: capturado e verificado', 30, 375);
  evidenciaCtx.fillText('via BODYCAM 01 - XPTO INC.', 30, 398);

  evidenciaTexture.needsUpdate = true;
  evidenciaMaterial.opacity = 1;
  evidenciaPlano.visible = true;
  evidenciaTempoRestanteMs = EVIDENCIA_DURACAO_MS;
}

const EVIDENCIA_DURACAO_MS = 5000;
const EVIDENCIA_FADEOUT_SEGUNDOS = 0.6;
let evidenciaTempoRestanteMs = 0;

function atualizarPainelDeEvidencia(delta) {
  if (evidenciaTempoRestanteMs <= 0) return;
  evidenciaTempoRestanteMs -= delta * 1000;

  const fadeoutMs = EVIDENCIA_FADEOUT_SEGUNDOS * 1000;
  if (evidenciaTempoRestanteMs <= fadeoutMs) {
    evidenciaMaterial.opacity = Math.max(0, evidenciaTempoRestanteMs / fadeoutMs);
  }

  if (evidenciaTempoRestanteMs <= 0) {
    evidenciaPlano.visible = false;
  }
}

// --- DEBUG: painel visual mostrando a posição da câmera em tempo real ---
// Temporário - serve pra você achar coordenadas sem precisar abrir o
// console. Quando terminar de posicionar as coisas, é só remover esse
// bloco (e a chamada de desenharDebugPosicao() no loop de animação).
const debugPosCanvas = document.createElement('canvas');
debugPosCanvas.width = 512;
debugPosCanvas.height = 160;
const debugPosCtx = debugPosCanvas.getContext('2d');
const debugPosTexture = new THREE.CanvasTexture(debugPosCanvas);

function desenharDebugPosicao() {
  const pos = new THREE.Vector3();
  camera.getWorldPosition(pos);

  debugPosCtx.clearRect(0, 0, debugPosCanvas.width, debugPosCanvas.height);
  debugPosCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  debugPosCtx.fillRect(0, 0, debugPosCanvas.width, debugPosCanvas.height);
  debugPosCtx.strokeStyle = '#00ff88';
  debugPosCtx.lineWidth = 3;
  debugPosCtx.strokeRect(3, 3, debugPosCanvas.width - 6, debugPosCanvas.height - 6);

  debugPosCtx.textAlign = 'left';
  debugPosCtx.textBaseline = 'middle';
  debugPosCtx.fillStyle = '#00ff88';
  debugPosCtx.font = 'bold 34px monospace';
  debugPosCtx.fillText(`X: ${pos.x.toFixed(2)}`, 24, 40);
  debugPosCtx.fillText(`Y: ${pos.y.toFixed(2)}`, 24, 80);
  debugPosCtx.fillText(`Z: ${pos.z.toFixed(2)}`, 24, 120);

  debugPosTexture.needsUpdate = true;
}

const debugPosMaterial = new THREE.MeshBasicMaterial({
  map: debugPosTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const debugPosPlano = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.11), debugPosMaterial);
// Canto oposto ao HUD (que fica em -0.35, 0.22), pra não sobrepor.
debugPosPlano.position.set(0.35, 0.22, -0.6);
debugPosPlano.renderOrder = 999;
camera.add(debugPosPlano);

const hudMaterial = new THREE.MeshBasicMaterial({
  map: hudTexture,
  transparent: true,
  depthTest: false,
});
const hudPlano = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), hudMaterial);
const HUD_POSICAO_CANTO = new THREE.Vector3(-0.35, 0.22, -0.6);
const HUD_POSICAO_CENTRO = new THREE.Vector3(0, 0, -0.6);
hudPlano.position.copy(HUD_POSICAO_CANTO);
hudPlano.renderOrder = 999;
hudPlano.visible = false;
camera.add(hudPlano);

function somarPonto() {
  score += 1;
  desenharHUD();
}

function iniciarJogo() {
  score = 0;
  tempoRestante = DURACAO_JOGO_SEGUNDOS;
  jogoAtivo = true;
  jogoJaTerminou = false;
  municaoAtual = MUNICAO_CAPACIDADE;
  recarregando = false;
  reiniciarDeteccaoDeEstresse();
  iniciarComandoDeVoz();
  iniciarAnaliseDeVoz();
  clearTimeout(hudEsconderTimeoutId);
  hudPlano.position.copy(HUD_POSICAO_CANTO);
  hudPlano.scale.set(1, 1, 1);
  hudPlano.visible = true;
  desenharHUD();

  if (gunModel) gunModel.visible = true;
  if (controllerModel1) controllerModel1.visible = false;

  clearInterval(timerIntervalId);
  timerIntervalId = setInterval(() => {
    tempoRestante -= 1;
    desenharHUD();
    if (tempoRestante <= 0) {
      finalizarJogoPorTempo();
    }
  }, 1000);
}

function finalizarJogoPorTempo() {
  if (!jogoAtivo) return;

  enviarResultadoDoTreinamento();

  portasTotemAbertas = false;
  [portaEsquerdaAction, portaDireitaAction].forEach((action) => {
    if (!action) return;
    action.paused = false;
    action.timeScale = -1;
    action.play();
  });
  tocarSomDaPorta();

  alvos.forEach((alvo) => {
    clearTimeout(alvo.timeoutId);
    sumirAlvo(alvo);
  });

  pararJogo();
}

const HUD_TEMPO_ATE_SUMIR_MS = 10000;
let hudEsconderTimeoutId = null;

function pararJogo() {
  clearInterval(timerIntervalId);
  pararComandoDeVoz();
  pararAnaliseDeVoz();
  jogoAtivo = false;
  jogoJaTerminou = true;
  hudPlano.position.copy(HUD_POSICAO_CENTRO);
  hudPlano.scale.set(1.8, 1.8, 1);
  desenharHUD();

  if (gunModel) gunModel.visible = false;
  if (controllerModel1) controllerModel1.visible = true;

  clearTimeout(hudEsconderTimeoutId);
  hudEsconderTimeoutId = setTimeout(() => {
    hudPlano.visible = false;
  }, HUD_TEMPO_ATE_SUMIR_MS);
}

// --- Levar tiro / vida do jogador ---

function restaurarVida() {
  vidaJogador = VIDA_MAXIMA;
  jogadorMorto = false;
  bandido2JaTocouVirando = false;
  municaoAtual = MUNICAO_CAPACIDADE;
  recarregando = false;
  reiniciarDeteccaoDeEstresse();
  combateInicioTimestamp = Date.now();
  resultadoJaEnviadoNestaSessao = false;
  comandosVerbaisDetectados = 0;
  justificativasDeUsoDaForca = [];
  desenharHUD();
}

// --- Feedback de estresse baseado em comportamento ---
// Não usa nenhum sensor - só observa dois números que o próprio jogo já
// tem: o quanto a mira "treme" (mudança de direção frame a frame) e a
// precisão (tiros dados vs. tiros que acertaram algo). Tudo aqui é
// matemática simples sobre dados que já existem - sem raycast novo, sem
// geometria nova, então não deve pesar nem travar nada.
let tirosDisparados = 0;
let tirosCertos = 0;
let miraDirecaoAnterior = null;
let miraJitterEMA = 0; // "tremor médio" da mira, em radianos por segundo
let estresseAcumuladorSegundos = 0;

const ESTRESSE_INTERVALO_AVALIACAO_SEGUNDOS = 7;
const ESTRESSE_JITTER_LIMIAR = 1.8; // acima disso, considera "mira tremendo muito" (ajustável)

let miraJitterPico = 0; // maior valor de tremor atingido na sessão
let vezesMiraInstavel = 0; // quantas vezes o aviso "MIRA INSTÁVEL" apareceu

function reiniciarDeteccaoDeEstresse() {
  tirosDisparados = 0;
  tirosCertos = 0;
  miraDirecaoAnterior = null;
  miraJitterEMA = 0;
  miraJitterPico = 0;
  vezesMiraInstavel = 0;
  vozInstabilidadeEMA = 0;
  vozInstavelDetectada = 0;
  vozHistoricoRMS = [];
  estresseAcumuladorSegundos = 0;
}

// Chamado a cada frame do loop de animação - só faz a conta e guarda o
// resultado, não desenha nada na tela (isso só acontece na avaliação
// periódica, mais abaixo).
function atualizarTremorDaMira(delta) {
  const armaAtiva = jogoAtivo || modoCombateAtivo;
  if (!armaAtiva || delta <= 0) return;

  const direcaoAtual = new THREE.Vector3();
  controller1.getWorldDirection(direcaoAtual);

  if (miraDirecaoAnterior) {
    const angulo = direcaoAtual.angleTo(miraDirecaoAnterior); // radianos
    const velocidadeAngular = angulo / delta; // radianos por segundo
    // Média móvel - dá mais peso pros frames recentes, sem precisar
    // guardar um histórico de frames antigos.
    miraJitterEMA = miraJitterEMA * 0.92 + velocidadeAngular * 0.08;
    if (miraJitterEMA > miraJitterPico) miraJitterPico = miraJitterEMA;
  }

  if (!miraDirecaoAnterior) miraDirecaoAnterior = new THREE.Vector3();
  miraDirecaoAnterior.copy(direcaoAtual);
}

function avaliarEstresseEDarFeedback() {
  const miraInstavel = miraJitterEMA > ESTRESSE_JITTER_LIMIAR;
  const vozInstavel = vozInstabilidadeEMA > VOZ_INSTABILIDADE_LIMIAR;

  if (miraInstavel) {
    vezesMiraInstavel += 1;
    mostrarAviso('MIRA INSTÁVEL', 'Respire fundo antes de engajar.');
  } else if (vozInstavel) {
    vozInstavelDetectada += 1;
    mostrarAviso('VOZ INSTÁVEL', 'Fale com firmeza e clareza ao dar comandos.');
  }
}

// Chamado a cada frame - só acumula tempo e dispara a avaliação no
// intervalo certo, não fica avaliando toda hora à toa.
function atualizarDeteccaoDeEstresse(delta) {
  const armaAtiva = jogoAtivo || modoCombateAtivo;
  atualizarTremorDaMira(delta);
  atualizarAnaliseDeVoz();

  if (!armaAtiva) return;

  estresseAcumuladorSegundos += delta;
  if (estresseAcumuladorSegundos >= ESTRESSE_INTERVALO_AVALIACAO_SEGUNDOS) {
    estresseAcumuladorSegundos = 0;
    avaliarEstresseEDarFeedback();
  }
}

const RECEBER_DANO_ATRASO_MS = 5000; // tudo (vida, vinheta, cartela) começa 5s depois do tiro

function receberDano(quantidade) {
  if (jogadorMorto || !modoCombateAtivo) return;

  // Não aplica nada na hora - espera 3 segundos (como se a bala estivesse
  // "chegando") antes de baixar a vida e mostrar os efeitos.
  setTimeout(() => {
    if (jogadorMorto || !modoCombateAtivo) return; // pode ter mudado nesse meio tempo

    vidaJogador = Math.max(0, vidaJogador - quantidade);
    desenharHUD();
    piscarDano();
    tocarSomDeBalaPassando();
    mostrarAviso('VOCÊ LEVOU UM TIRO!', 'Proteja-se atrás da barricada!');

    // O grito de ameaça toca 2 segundos depois da cartela aparecer.
    setTimeout(() => {
      tocarGritoDeAmeacaDoBandido();
    }, 2000);

    // O segundo bandido toca a animação "virando" 3 segundos depois da
    // cartela aparecer, uma única vez por sessão de combate.
    if (!bandido2JaTocouVirando) {
      bandido2JaTocouVirando = true;
      setTimeout(() => {
        if (bandido2VirandoAction) {
          bandido2VirandoAction.reset();
          bandido2VirandoAction.play();
          console.log('Segundo bandido: tocando animação "virando" (3s depois da cartela).');
        }
      }, 3000);
    }

    // Vibração na mão direita (onde fica a arma) como feedback de "levei tiro"
    vibrarControle(controller1, 0.7, 120);

    if (vidaJogador <= 0) {
      jogadorMorreu();
    }
  }, RECEBER_DANO_ATRASO_MS);
}

function pararCombate() {
  clearInterval(bandidoTiroIntervalId);
  pararComandoDeVoz();
  pararAnaliseDeVoz();
  pararSessaoDeMonitoramento();
  modoCombateAtivo = false;
  desenharHUD();
}

// --- Comando verbal por voz ---
// Usa o reconhecimento de fala nativo do navegador (Web Speech API) - não
// precisa de nenhuma biblioteca externa. Fica "ouvindo" só durante o
// combate, procurando por palavras de comando policial na sua fala real.
// Se o navegador não suportar isso (ou você negar o microfone), o resto
// do jogo continua funcionando 100% normal - só essa parte fica desligada.
const PALAVRAS_DE_COMANDO = ['polícia', 'policia', 'mãos', 'maos', 'parado', 'parada', 'abaixe', 'chão', 'chao'];
let reconhecimentoDeVoz = null;
let reconhecimentoDeVozAtivo = false;
let comandosVerbaisDetectados = 0;

function iniciarComandoDeVoz() {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) {
    console.warn('[Voz] Este navegador não suporta reconhecimento de fala - comando verbal desativado, resto do jogo funciona normal.');
    return;
  }

  if (!reconhecimentoDeVoz) {
    reconhecimentoDeVoz = new SpeechRecognitionAPI();
    reconhecimentoDeVoz.lang = 'pt-BR';
    reconhecimentoDeVoz.continuous = true;
    reconhecimentoDeVoz.interimResults = false;

    reconhecimentoDeVoz.onresult = (evento) => {
      const ultimoResultado = evento.results[evento.results.length - 1];
      const texto = ultimoResultado[0].transcript.toLowerCase();
      console.log('[Voz] Reconhecido:', texto);

      const contemComando = PALAVRAS_DE_COMANDO.some((palavra) => texto.includes(palavra));
      if (contemComando) {
        comandosVerbaisDetectados += 1;
        if (comandosVerbaisDetectados === 1) {
          mostrarAviso('COMANDO VERBAL REGISTRADO', 'Aviso dado antes do uso da força.');
        }
        registrarEventoDeSessao('comando_verbal', 'Comando verbal registrado', false);
        console.log('[Voz] Comando de polícia detectado! Total na sessão:', comandosVerbaisDetectados);
      }
    };

    reconhecimentoDeVoz.onerror = (evento) => {
      console.warn('[Voz] Erro no reconhecimento (mic negado ou indisponível):', evento.error);
    };

    // Alguns navegadores encerram o reconhecimento sozinhos depois de um
    // tempo - reinicia automaticamente enquanto o combate estiver ativo.
    reconhecimentoDeVoz.onend = () => {
      if (reconhecimentoDeVozAtivo) {
        try {
          reconhecimentoDeVoz.start();
        } catch {
          // já pode estar rodando - ignora
        }
      }
    };
  }

  try {
    reconhecimentoDeVozAtivo = true;
    reconhecimentoDeVoz.start();
    console.log('[Voz] .start() chamado - fale um comando tipo "Polícia! Mãos ao alto!"');
  } catch (erro) {
    console.warn('[Voz] Não consegui iniciar o reconhecimento:', erro);
  }
}

function pararComandoDeVoz() {
  reconhecimentoDeVozAtivo = false;
  if (reconhecimentoDeVoz) {
    try {
      reconhecimentoDeVoz.stop();
    } catch {
      // ignora - pode já estar parado
    }
  }
}

// --- Análise de instabilidade vocal (volume/amplitude) ---
// IMPORTANTE: isso NÃO é um "detector de estresse psicológico" de
// verdade - isso seria pseudociência, e detectores de "stress por voz"
// desse tipo são bem contestados cientificamente até em uso profissional.
// O que isso faz de verdade, com honestidade técnica: mede o quanto o
// VOLUME da sua voz oscila de forma instável enquanto você fala (o termo
// técnico é "shimmer" - flutuação de amplitude). É só um indicador
// aproximado, não uma medição clínica.
let audioContextVoz = null;
let analiserVoz = null;
let streamVoz = null;
let vozInstabilidadeEMA = 0;
let vozInstavelDetectada = 0;
const VOZ_LIMIAR_SILENCIO = 0.02; // abaixo disso, considera que não tem fala (evita medir silêncio)
const VOZ_INSTABILIDADE_LIMIAR = 0.55; // acima disso, considera "voz instável" (ajustável)

async function iniciarAnaliseDeVoz() {
  try {
    streamVoz = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContextVoz = new (window.AudioContext || window.webkitAudioContext)();
    const fonte = audioContextVoz.createMediaStreamSource(streamVoz);
    analiserVoz = audioContextVoz.createAnalyser();
    analiserVoz.fftSize = 1024;
    fonte.connect(analiserVoz);
    console.log('[Voz] Análise de volume/instabilidade iniciada.');
  } catch (erro) {
    console.warn('[Voz] Não consegui acessar o microfone pra análise de instabilidade:', erro);
  }
}

function pararAnaliseDeVoz() {
  if (streamVoz) {
    streamVoz.getTracks().forEach((track) => track.stop());
    streamVoz = null;
  }
  if (audioContextVoz) {
    audioContextVoz.close().catch(() => {});
    audioContextVoz = null;
  }
  analiserVoz = null;
}

const vozBufferAmplitude = new Uint8Array(1024);
let vozHistoricoRMS = [];

// Chamado a cada frame - calcula o volume atual e vai guardando um
// histórico curto (último ~1 segundo) pra medir o quão instável ele está.
function atualizarAnaliseDeVoz() {
  if (!analiserVoz) return;

  analiserVoz.getByteTimeDomainData(vozBufferAmplitude);

  // RMS (root mean square) - forma padrão de medir "volume" de um sinal de áudio.
  let somaQuadrados = 0;
  for (let i = 0; i < vozBufferAmplitude.length; i++) {
    const amostra = (vozBufferAmplitude[i] - 128) / 128; // normaliza pra -1..1
    somaQuadrados += amostra * amostra;
  }
  const rms = Math.sqrt(somaQuadrados / vozBufferAmplitude.length);

  if (rms < VOZ_LIMIAR_SILENCIO) return; // sem fala relevante agora, não conta

  vozHistoricoRMS.push(rms);
  if (vozHistoricoRMS.length > 30) vozHistoricoRMS.shift(); // ~1s de histórico

  if (vozHistoricoRMS.length >= 8) {
    const media = vozHistoricoRMS.reduce((a, b) => a + b, 0) / vozHistoricoRMS.length;
    const variancia = vozHistoricoRMS.reduce((a, b) => a + (b - media) ** 2, 0) / vozHistoricoRMS.length;
    const desvioPadrao = Math.sqrt(variancia);
    const instabilidadeRelativa = media > 0 ? desvioPadrao / media : 0; // "shimmer" relativo

    vozInstabilidadeEMA = vozInstabilidadeEMA * 0.9 + instabilidadeRelativa * 0.1;
  }
}

// --- Resultado de missão (envio pro servidor, mostrado numa página separada) ---
// Igual o sistema de evidências: em vez de criar uma tela nova dentro do
// jogo (mais risco de travar algo), a gente só manda os dados pro
// servidor e o resultado fica visível numa página própria (resultados.html).
let combateInicioTimestamp = null;
let justificativasDeUsoDaForca = [];
let resultadoJaEnviadoNestaSessao = false;

// --- Central do Instrutor: relatório da sessão (não é ao vivo) ---
// Um ID único identifica a sessão inteira - evidências, resultado final e
// os eventos aqui usam o MESMO id, pra tudo aparecer junto no relatório
// depois. Diferente de monitoramento ao vivo, isso NÃO fica checando o
// servidor toda hora - só manda um evento quando algo relevante realmente
// acontece (bodycam, evidência, comando verbal, neutralização).
let sessaoIdAtual = null;

function gerarIdSessao() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const aleatorio = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SESSAO-${timestamp}-${aleatorio}`;
}

function iniciarSessaoDeMonitoramento() {
  sessaoIdAtual = gerarIdSessao();
  console.log('[Central] Sessão iniciada:', sessaoIdAtual);
}

function pararSessaoDeMonitoramento() {
  sessaoIdAtual = null;
}

function posicaoAtualDoJogador() {
  return { x: player.position.x, y: player.position.y, z: player.position.z };
}

// Registra um evento na linha do tempo da sessão (pro relatório final). A
// posição só é enviada quando fizer sentido (bodycam, evidência) - não é
// rastreamento contínuo, só um retrato do instante daquele evento. Cada
// chamada é um único request leve - não roda em loop nenhum.
async function registrarEventoDeSessao(tipo, descricao, incluirPosicao = false) {
  if (!sessaoIdAtual) return;
  try {
    await fetch('/api/registrar-evento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessaoId: sessaoIdAtual,
        tipo,
        descricao,
        posicao: incluirPosicao ? posicaoAtualDoJogador() : null,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (erro) {
    console.error('[Central] Falha ao registrar evento:', erro);
  }
}

function gerarIdResultado() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const aleatorio = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SES-${timestamp}-${aleatorio}`;
}

function finalizarSessaoDeCombate(resultado) {
  if (resultadoJaEnviadoNestaSessao) return;
  resultadoJaEnviadoNestaSessao = true;

  const duracaoSegundos = combateInicioTimestamp
    ? Math.round((Date.now() - combateInicioTimestamp) / 1000)
    : 0;
  const precisao = tirosDisparados > 0 ? tirosCertos / tirosDisparados : 0;
  const bandidosNeutralizados = (bandidoVivo ? 0 : 1) + (bandido2Vivo ? 0 : 1);

  const dados = {
    id: gerarIdResultado(),
    tipo: 'combate',
    timestamp: new Date().toISOString(),
    resultado, // 'sobreviveu' ou 'morreu'
    tirosDisparados,
    tirosCertos,
    precisao,
    vidaRestante: vidaJogador,
    bandidosNeutralizados,
    duracaoSegundos,
    avisosDeMiraInstavel: vezesMiraInstavel,
    tremorPico: Number(miraJitterPico.toFixed(2)),
    comandosVerbaisDetectados,
    deuComandoVerbal: comandosVerbaisDetectados > 0,
    avisosDeVozInstavel: vozInstavelDetectada,
    justificativasDeUsoDaForca,
    usoDaForcaCorreto: justificativasDeUsoDaForca.filter((j) => j.motivo === 'ameaca_armada').length,
    usoDaForcaIndevido: justificativasDeUsoDaForca.filter((j) => j.motivo === 'uso_indevido').length,
    sessaoId: sessaoIdAtual,
  };

  console.log('[Resultado] Sessão finalizada:', dados);
  enviarResultadoParaServidor(dados);
}

async function enviarResultadoParaServidor(dados) {
  try {
    const resposta = await fetch('/api/salvar-resultado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });
    if (!resposta.ok) throw new Error(`Servidor respondeu ${resposta.status}`);
    console.log('[Resultado] Enviado pro servidor com sucesso.');
  } catch (erro) {
    console.error('[Resultado] FALHOU ao enviar pro servidor:', erro);
  }
}

// Resultado do treinamento no totem (jogo de alvos) - tipo diferente do
// combate, pra aparecer separado na página de resultados. Precisa ser
// chamado ANTES de qualquer reset dos contadores (tirosDisparados/
// tirosCertos), senão os números já teriam zerado.
function enviarResultadoDoTreinamento() {
  const duracaoSegundos = DURACAO_JOGO_SEGUNDOS - Math.max(0, tempoRestante);
  const precisao = tirosDisparados > 0 ? tirosCertos / tirosDisparados : 0;

  const dados = {
    id: gerarIdResultado(),
    tipo: 'treinamento',
    timestamp: new Date().toISOString(),
    score,
    alvosAcertados: tirosCertos,
    tirosDisparados,
    precisao,
    duracaoSegundos,
    avisosDeMiraInstavel: vezesMiraInstavel,
    tremorPico: Number(miraJitterPico.toFixed(2)),
    comandosVerbaisDetectados,
    deuComandoVerbal: comandosVerbaisDetectados > 0,
    avisosDeVozInstavel: vozInstavelDetectada,
  };

  console.log('[Resultado] Treinamento finalizado:', dados);
  enviarResultadoParaServidor(dados);
}

function jogadorMorreu() {
  jogadorMorto = true;
  console.log('Jogador morreu no combate do carro do BOPE!');
  finalizarSessaoDeCombate('morreu');
  // Por enquanto só desliga o modo combate (para o bandido de atirar, some a barra).
  // Se você quiser: teleportar de volta a um spawn, tocar som/animação de morte,
  // mostrar uma tela de "Game Over" no HUD, etc - é aqui que entra.
  pararCombate();
}

// O bandido atira periodicamente enquanto estiver vivo e o modo combate ligado
// (ligado ao entrar no carro do BOPE, não ao totem). Quanto mais perto o
// jogador estiver, maior a chance de o tiro acertar.
const BANDIDO_TIRO_INTERVALO_MS = 2000;
const BANDIDO_TIRO_DANO = 10;
const BANDIDO_TIRO_ALCANCE_MAX = 100; // metros - aumentado pra cobrir a posição real do bandido
const BANDIDO_TIRO_CHANCE_ACERTO = 0.35; // 35% de chance de acertar por "rajada"
let bandidoTiroIntervalId = null;

const raycasterBandido = new THREE.Raycaster();

// Verifica se tem algo sólido (parede, barricada, carro, etc) bloqueando a
// visão entre o bandido e o jogador. Se o jogador estiver escondido atrás
// de um obstáculo, o bandido não consegue acertar, mesmo estando perto.
function bandidoTemLinhaDeVisaoPraJogador(posBandido, distanciaAoJogador) {
  const direcao = new THREE.Vector3().subVectors(player.position, posBandido).normalize();
  // Sobe a origem um pouco (altura dos "olhos" do bandido), pra não bater no próprio chão dele.
  const origem = posBandido.clone();
  origem.y += 1.2;

  raycasterBandido.set(origem, direcao);
  raycasterBandido.far = distanciaAoJogador;

  const intersects = raycasterBandido.intersectObject(scene, true);

  for (const hit of intersects) {
    // Ignora o próprio corpo do bandido (não deixa ele "se bloquear sozinho")
    // e também tudo que estiver "grudado" na câmera (HUD, vinheta vermelha,
    // cartela de aviso, painel de debug) - esses painéis ficam bem na frente
    // da sua visão e não são obstáculos de verdade, são só interface.
    let obj = hit.object;
    let ehIgnoravel = false;
    while (obj) {
      if (obj === bandidoObjeto || obj === camera) {
        ehIgnoravel = true;
        break;
      }
      obj = obj.parent;
    }
    if (ehIgnoravel) continue;

    // Achou algo sólido bem antes de chegar perto do jogador = tá bloqueado.
    if (hit.distance < distanciaAoJogador - 0.5) {
      return false;
    }
  }

  return true;
}

function iniciarTiroDoBandido() {
  clearInterval(bandidoTiroIntervalId);
  bandidoTiroIntervalId = setInterval(() => {
    if (!bandidoVivo || !modoCombateAtivo || !bandidoObjeto || !bandidoObjeto.visible) return;

    const posBandido = new THREE.Vector3();
    bandidoObjeto.getWorldPosition(posBandido);
    const distancia = posBandido.distanceTo(player.position);

    if (distancia > BANDIDO_TIRO_ALCANCE_MAX) {
      console.log(`[DEBUG bandido] distância: ${distancia.toFixed(1)}m | fora de alcance (máx ${BANDIDO_TIRO_ALCANCE_MAX}m)`);
      return;
    }

    // Só atira de verdade se tiver linha de visão livre até você - se
    // estiver atrás de uma parede/barricada, ele não te acerta.
    const temVisao = bandidoTemLinhaDeVisaoPraJogador(posBandido, distancia);
    console.log(`[DEBUG bandido] distância: ${distancia.toFixed(1)}m | linha de visão livre: ${temVisao}`);
    if (!temVisao) return;

    tocarSomDeTiro();

    if (Math.random() < BANDIDO_TIRO_CHANCE_ACERTO) {
      receberDano(BANDIDO_TIRO_DANO);
    }
  }, BANDIDO_TIRO_INTERVALO_MS);
}

function pararTiroDoBandido() {
  clearInterval(bandidoTiroIntervalId);
}

const sfxAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

function tocarSomDeAcerto() {
  if (sfxAudioCtx.state === 'suspended') sfxAudioCtx.resume();

  const agora = sfxAudioCtx.currentTime;

  const oscillator = sfxAudioCtx.createOscillator();
  const gainNode = sfxAudioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(sfxAudioCtx.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, agora);
  oscillator.frequency.exponentialRampToValueAtTime(220, agora + 0.15);

  gainNode.gain.setValueAtTime(0.3, agora);
  gainNode.gain.exponentialRampToValueAtTime(0.01, agora + 0.15);

  oscillator.start(agora);
  oscillator.stop(agora + 0.15);
}

let mixerAlvos = null;
const alvos = [];

loader.load(
  '/alvos.glb',
  (gltf) => {
    const model = gltf.scene;

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
    mixerAlvos = new THREE.AnimationMixer(model);

    console.log('--- Nomes de TODOS os objetos dentro do alvos.glb ---');
    model.traverse((child) => console.log(`  objeto: "${child.name}" (isMesh: ${child.isMesh})`));
    console.log('--- Nomes de TODAS as animações dentro do alvos.glb ---');
    console.log(gltf.animations.map((c) => `"${c.name}"`));
    console.log('------------------------------------------------------');

    model.traverse((child) => {
      if (!child.name || !/^alvo/i.test(child.name)) return;

      const clipName = `${child.name}Action`;
      const clip = gltf.animations.find((c) => c.name.toLowerCase() === clipName.toLowerCase());
      if (!clip) {
        console.warn(`Objeto "${child.name}" parece um alvo, mas não achei a animação "${clipName}". Animações disponíveis:`, gltf.animations.map((c) => c.name));
        return;
      }

      const action = mixerAlvos.clipAction(clip, child);
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;

      action.play();
      action.paused = true;
      action.time = 0;

      alvos.push({ objeto: child, action, podeAtirar: false, timeoutId: null });
    });

    mixerAlvos.update(0);
    console.log(`${alvos.length} alvo(s) detectado(s):`, alvos.map((a) => a.objeto.name));
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar os alvos:', error);
  }
);

const ALVO_VELOCIDADE = 1.3;
const ALVO_TEMPO_ESCONDIDO = 2000;

function surgirAlvo(alvo) {
  clearTimeout(alvo.timeoutId);
  alvo.action.paused = false;
  alvo.action.timeScale = ALVO_VELOCIDADE;
  alvo.action.reset();
  alvo.action.play();
  alvo.podeAtirar = true;
}

function sumirAlvo(alvo) {
  clearTimeout(alvo.timeoutId);
  alvo.action.paused = false;
  alvo.action.timeScale = -ALVO_VELOCIDADE;
  alvo.action.play();
  alvo.podeAtirar = false;
}

function acertarAlvo(alvo) {
  if (!alvo.podeAtirar) return;
  tirosCertos += 1;

  somarPonto();
  tocarSomDeAcerto();
  sumirAlvo(alvo);

  alvo.timeoutId = setTimeout(() => surgirAlvo(alvo), ALVO_TEMPO_ESCONDIDO);
}

const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

// --- MARCADOR DE CALIBRAÇÃO / MIRA ---
// Mostra visualmente onde o raio do tiro está batendo, pra você calibrar
// a mira da arma física comparando com o alvo real. Pode desligar
// colocando MOSTRAR_MARCADOR_TIRO = false quando não precisar mais.
const MOSTRAR_MARCADOR_TIRO = true;
const MARCADOR_DURACAO_MS = 400;

function criarMarcadorDeImpacto(posicao) {
  const geometry = new THREE.SphereGeometry(0.03, 8, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });
  const marcador = new THREE.Mesh(geometry, material);
  marcador.position.copy(posicao);
  scene.add(marcador);
  setTimeout(() => {
    scene.remove(marcador);
    geometry.dispose();
    material.dispose();
  }, MARCADOR_DURACAO_MS);
}

function mostrarPontoDeImpacto(controller, pontoImpacto) {
  if (!MOSTRAR_MARCADOR_TIRO) return;

  const origem = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  const distancia = pontoImpacto ? origem.distanceTo(pontoImpacto) : null;

  if (pontoImpacto) {
    criarMarcadorDeImpacto(pontoImpacto);
  }

  console.log(
    '[MIRA] Origem:', origem.toArray().map((n) => n.toFixed(2)),
    '| Impacto:', pontoImpacto ? pontoImpacto.toArray().map((n) => n.toFixed(2)) : 'nenhum objeto atingido',
    '| Distância:', distancia ? distancia.toFixed(2) + 'm' : '-'
  );
}

function verificarTiro(controller) {
  // A arma só "existe" (visível/funcional) durante o treino do totem OU o
  // combate do carro do BOPE. Fora disso, o gatilho não faz nada.
  const armaAtiva = jogoAtivo || modoCombateAtivo;
  if (!armaAtiva) return;

  if (recarregando) return; // não atira no meio da recarga

  if (municaoAtual <= 0) {
    tocarSomDeClique();
    return;
  }

  municaoAtual -= 1;
  tirosDisparados += 1;
  atualizarHUDMunicao();

  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  // Som, vibração e o flash de luz tocam sempre que aperta o gatilho com a
  // arma ativa, mesmo que não tenha nenhum alvo/bandido pra acertar no momento.
  tocarSomDeTiro();
  piscarLuzDoTiro();
  vibrarControle(controller);

  const alvosAtiraveis = alvos.filter((a) => a.podeAtirar).map((a) => a.objeto);
  const objetosAtiraveis = [...alvosAtiraveis];
  if (bandidoObjeto && bandidoVivo) objetosAtiraveis.push(bandidoObjeto);
  if (bandido2Objeto && bandido2Vivo) objetosAtiraveis.push(bandido2Objeto);

  if (objetosAtiraveis.length === 0) {
    // Nada pra acertar, mas ainda mostra pra onde o tiro foi (10m à frente)
    const pontoNoVazio = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 10);
    mostrarPontoDeImpacto(controller, pontoNoVazio);
    return;
  }

  const intersects = raycaster.intersectObjects(objetosAtiraveis, true);

  if (intersects.length === 0) {
    // Não acertou nenhum alvo, mas ainda mostra pra onde o tiro foi (10m à frente)
    const pontoNoVazio = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 10);
    mostrarPontoDeImpacto(controller, pontoNoVazio);
    return;
  }

  mostrarPontoDeImpacto(controller, intersects[0].point);

  let atingido = intersects[0].object;
  while (
    atingido &&
    !alvos.some((a) => a.objeto === atingido) &&
    atingido !== bandidoObjeto &&
    atingido !== bandido2Objeto
  ) {
    atingido = atingido.parent;
  }

  console.log('[DEBUG tiro] objeto atingido:', atingido ? atingido.name || atingido.type : 'nenhum', '| é o bandido?', atingido === bandidoObjeto, '| bandidoVivo:', bandidoVivo);

  const alvo = alvos.find((a) => a.objeto === atingido);
  if (alvo) {
    acertarAlvo(alvo);
    return;
  }

  if (atingido === bandidoObjeto) {
    criarEfeitoDeSangue(intersects[0].point, raycaster.ray.direction);
    mostrarIndicadorDeAcerto(encontrarRegiaoAtingida(bandidoObjeto, intersects[0].point));
    acertarBandido();
    return;
  }

  if (atingido === bandido2Objeto) {
    criarEfeitoDeSangue(intersects[0].point, raycaster.ray.direction);
    mostrarIndicadorDeAcerto(encontrarRegiaoAtingida(bandido2Objeto, intersects[0].point));
    acertarBandido2();
  }
}

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

const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);

// Grip = posição real da mão/pulso (diferente do "controller", que é a direção do laser/mira).
// Usamos o grip pra medir distância e segurar objetos, senão a distância fica errada.
const controllerGrip0 = renderer.xr.getControllerGrip(0);
const controllerGrip1 = renderer.xr.getControllerGrip(1);
player.add(controllerGrip0);
player.add(controllerGrip1);

// Adiciona o modelo 3D visual do controle (a "réplica" do Touch controller) em cada mão.
const controllerModelFactory = new XRControllerModelFactory();
controllerGrip0.add(controllerModelFactory.createControllerModel(controllerGrip0));
const controllerModel1 = controllerModelFactory.createControllerModel(controllerGrip1);
controllerGrip1.add(controllerModel1);

// Arma (gun.glb): fica presa na mão direita, mas só aparece durante o treino de tiro.
let gunModel = null;

// Luz do flash de disparo - cor quente (tipo pólvora queimando), acesa
// só por uma fração de segundo a cada tiro. Fica escondida dentro do
// gunModel depois de carregado (veja o loader abaixo).
const luzDoTiro = new THREE.PointLight(0xffaa55, 0, 6, 2);
const LUZ_TIRO_DURACAO_MS = 70; // dura bem pouco, tipo um flash real
const LUZ_TIRO_INTENSIDADE_PICO = 8;
let luzTiroTempoRestanteMs = 0;

function piscarLuzDoTiro() {
  luzDoTiro.intensity = LUZ_TIRO_INTENSIDADE_PICO;
  luzTiroTempoRestanteMs = LUZ_TIRO_DURACAO_MS;
}

function atualizarLuzDoTiro(delta) {
  if (luzTiroTempoRestanteMs <= 0) return;
  luzTiroTempoRestanteMs -= delta * 1000;
  luzDoTiro.intensity = Math.max(0, (luzTiroTempoRestanteMs / LUZ_TIRO_DURACAO_MS) * LUZ_TIRO_INTENSIDADE_PICO);
  if (luzTiroTempoRestanteMs <= 0) luzDoTiro.intensity = 0;
}

loader.load(
  '/gun.glb',
  (gltf) => {
    gunModel = gltf.scene;
    gunModel.visible = false; // começa escondida - só aparece quando o jogo iniciar (totem)
    gunModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    controllerGrip1.add(gunModel);
    console.log('Arma (gun.glb) carregada e presa na mão direita.');

    // Luz do disparo (flash de tiro): fica na ponta do cano, apagada até você
    // atirar. Pisca forte e some rápido, tipo um flash real de arma de fogo.
    // Se a posição não parecer bater com o cano na sua arma, ajuste o
    // valor de position.set() abaixo (o eixo Z negativo costuma ser "pra
    // frente" do modelo, mas cada .glb pode ter orientação diferente).
    luzDoTiro.position.set(0, 0, -0.25);
    controllerGrip1.add(luzDoTiro);
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar a arma (gun.glb):', error);
  }
);

controller0.add(criarLaser());
controller1.add(criarLaser());

player.add(controller0);
player.add(controller1);

// Guarda o gamepad de cada controle assim que ele conecta, pra poder vibrar depois.
controller0.addEventListener('connected', (event) => {
  controller0.userData.gamepad = event.data.gamepad;
});
controller0.addEventListener('disconnected', () => {
  controller0.userData.gamepad = null;
});
controller1.addEventListener('connected', (event) => {
  controller1.userData.gamepad = event.data.gamepad;
});
controller1.addEventListener('disconnected', () => {
  controller1.userData.gamepad = null;
});

function vibrarControle(controller, intensidade = 1.0, duracaoMs = 60) {
  const gamepad = controller.userData.gamepad;
  if (!gamepad) return;

  const actuator = gamepad.hapticActuators && gamepad.hapticActuators[0];
  if (actuator && actuator.pulse) {
    actuator.pulse(intensidade, duracaoMs);
    return;
  }

  // Fallback pra navegadores/quest que usam a API mais nova (vibrationActuator)
  if (gamepad.vibrationActuator && gamepad.vibrationActuator.playEffect) {
    gamepad.vibrationActuator.playEffect('dual-rumble', {
      duration: duracaoMs,
      strongMagnitude: intensidade,
      weakMagnitude: intensidade,
    });
  }
}

controller1.addEventListener('selectstart', () => verificarTiro(controller1));

// Gatilho esquerdo - captura evidência (foto), já que essa mão não tem
// arma nenhuma mesmo. Só funciona com a bodycam ligada (botão A na direita).
controller0.addEventListener('selectstart', () => {
  console.log('[DEBUG captura] Gatilho esquerdo apertado! bodycamAtiva:', bodycamAtiva);
  if (bodycamAtiva) {
    capturarEvidencia();
  } else {
    console.warn('[DEBUG captura] Bodycam está desligada - aperte o botão A (direita) primeiro pra ligar.');
  }
});

// --- PEGAR / SOLTAR OBJETOS COM O GRIP ---
const DISTANCIA_MAXIMA_PEGAR = 0.35; // metros - precisa estar bem perto da mão pra pegar

function tentarPegarObjeto(controller) {
  if (controller.userData.objetoSegurado) return; // já tá com algo na mão

  const posicaoMao = new THREE.Vector3();
  controller.getWorldPosition(posicaoMao);

  let maisProximo = null;
  let menorDistancia = DISTANCIA_MAXIMA_PEGAR;

  for (const objeto of objetosPegaveis) {
    if (objeto.userData.segurandoPor) continue; // já tá na mão de outro controller

    const posicaoObjeto = new THREE.Vector3();
    objeto.getWorldPosition(posicaoObjeto);
    const distancia = posicaoMao.distanceTo(posicaoObjeto);

    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      maisProximo = objeto;
    }
  }

  if (maisProximo) {
    controller.attach(maisProximo); // reparenta mantendo a posição/rotação no mundo
    controller.userData.objetoSegurado = maisProximo;
    maisProximo.userData.segurandoPor = controller;
  }
}

function soltarObjeto(controller) {
  const objeto = controller.userData.objetoSegurado;
  if (!objeto) return;

  scene.attach(objeto); // reparenta de volta pra cena, mantendo a posição/rotação atual no mundo
  objeto.userData.segurandoPor = null;
  controller.userData.objetoSegurado = null;
}

controller0.addEventListener('squeezestart', () => {
  console.log('[DEBUG granada] squeeze esquerdo apertado. modoCombateAtivo:', modoCombateAtivo);
  // Em combate: grip esquerdo pega uma granada na mão (em vez do pickup normal).
  if (modoCombateAtivo) {
    pegarGranadaNaMao(controllerGrip0);
  } else {
    tentarPegarObjeto(controllerGrip0);
  }
});
controller0.addEventListener('squeezeend', () => {
  console.log('[DEBUG granada] squeeze esquerdo solto. granadaNaMao existe?', !!granadaNaMao);
  if (granadaNaMao) {
    arremessarGranada();
  } else {
    soltarObjeto(controllerGrip0);
  }
});
controller1.addEventListener('squeezestart', () => tentarPegarObjeto(controllerGrip1));
controller1.addEventListener('squeezeend', () => soltarObjeto(controllerGrip1));

function verificarInteracaoPorta(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  if (!portaObjeto || !portaAction) return;

  const intersects = raycaster.intersectObject(portaObjeto, true);
  if (intersects.length > 0) {
    console.log('Acertou a porta da garagem! Tocando animação...');
    portaAberta = !portaAberta;
    portaAction.paused = false;
    portaAction.timeScale = portaAberta ? 1 : -1;
    if (portaAberta) {
      portaAction.reset();
    }
    portaAction.play();
    tocarSomDaPorta();
  }
}

controller0.addEventListener('selectstart', () => verificarInteracaoPorta(controller0));
controller1.addEventListener('selectstart', () => verificarInteracaoPorta(controller1));

controller0.addEventListener('selectstart', () => verificarInteracaoTotem(controller0));
controller1.addEventListener('selectstart', () => verificarInteracaoTotem(controller1));

controller0.addEventListener('selectstart', () => verificarInteracaoPortasBope(controller0));
controller1.addEventListener('selectstart', () => verificarInteracaoPortasBope(controller1));

controller0.addEventListener('selectstart', () => verificarInteracaoElevador(controller0));
controller1.addEventListener('selectstart', () => verificarInteracaoElevador(controller1));

controller0.addEventListener('selectstart', () => verificarCliqueNoBodycam(controller0));
controller1.addEventListener('selectstart', () => verificarCliqueNoBodycam(controller1));

const MENU_LARGURA_MUNDO = 1.6;
const MENU_ALTURA_MUNDO = 0.8;
const MENU_CANVAS_LARGURA = 1024;
const MENU_CANVAS_ALTURA = 512;

const botaoIniciar = { x: 112, y: 340, largura: 420, altura: 100 };
const botaoSantaMarta = { x: 592, y: 340, largura: 420, altura: 100 };

const logoXpto = new Image();
let logoXptoCarregada = false;
logoXpto.onload = () => {
  logoXptoCarregada = true;
  desenharMenu();
};
logoXpto.src = '/logo.png';

const menuCanvas = document.createElement('canvas');
menuCanvas.width = MENU_CANVAS_LARGURA;
menuCanvas.height = MENU_CANVAS_ALTURA;
const menuCtx = menuCanvas.getContext('2d');

function desenharMenu() {
  const ctx = menuCtx;
  ctx.clearRect(0, 0, MENU_CANVAS_LARGURA, MENU_CANVAS_ALTURA);

  ctx.fillStyle = 'rgba(15, 15, 20, 0.92)';
  ctx.fillRect(0, 0, MENU_CANVAS_LARGURA, MENU_CANVAS_ALTURA);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, MENU_CANVAS_LARGURA - 8, MENU_CANVAS_ALTURA - 8);

  if (logoXptoCarregada) {
    const areaLargura = 560;
    const areaAltura = 180;
    const escala = Math.min(areaLargura / logoXpto.width, areaAltura / logoXpto.height);
    const largura = logoXpto.width * escala;
    const altura = logoXpto.height * escala;
    const x = (MENU_CANVAS_LARGURA - largura) / 2;
    const y = 60;
    ctx.drawImage(logoXpto, x, y, largura, altura);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ESCOLHA O MAPA', MENU_CANVAS_LARGURA / 2, 140);
  }

  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(botaoIniciar.x, botaoIniciar.y, botaoIniciar.largura, botaoIniciar.altura);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('INICIAR (DEMO)', botaoIniciar.x + botaoIniciar.largura / 2, botaoIniciar.y + 62);

  ctx.fillStyle = '#555555';
  ctx.fillRect(botaoSantaMarta.x, botaoSantaMarta.y, botaoSantaMarta.largura, botaoSantaMarta.altura);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText('SANTA MARTA', botaoSantaMarta.x + botaoSantaMarta.largura / 2, botaoSantaMarta.y + 50);
  ctx.font = '24px sans-serif';
  ctx.fillText('(em breve)', botaoSantaMarta.x + botaoSantaMarta.largura / 2, botaoSantaMarta.y + 85);

  menuTexture.needsUpdate = true;
}

const menuTexture = new THREE.CanvasTexture(menuCanvas);
const menuMaterial = new THREE.MeshBasicMaterial({ map: menuTexture, transparent: true });
const menuPanel = new THREE.Mesh(new THREE.PlaneGeometry(MENU_LARGURA_MUNDO, MENU_ALTURA_MUNDO), menuMaterial);

menuPanel.position.set(0, 1.6, 1.2);
scene.add(menuPanel);
desenharMenu();

let jogoIniciado = false;

function verificarCliqueNoMenu(controller) {
  if (jogoIniciado || !menuPanel.visible) return;

  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  const intersects = raycaster.intersectObject(menuPanel, true);
  if (intersects.length === 0 || !intersects[0].uv) return;

  const uv = intersects[0].uv;
  const px = uv.x * MENU_CANVAS_LARGURA;
  const py = (1 - uv.y) * MENU_CANVAS_ALTURA;

  const dentroDoBotao = (botao) =>
    px >= botao.x && px <= botao.x + botao.largura &&
    py >= botao.y && py <= botao.y + botao.altura;

  if (dentroDoBotao(botaoIniciar)) {
    console.log('Menu: INICIAR (Demo UFA3) clicado.');
    jogoIniciado = true;
    scene.remove(menuPanel);
  } else if (dentroDoBotao(botaoSantaMarta)) {
    console.log('Menu: Santa Marta ainda não está disponível.');
  }
}

controller0.addEventListener('selectstart', () => verificarCliqueNoMenu(controller0));
controller1.addEventListener('selectstart', () => verificarCliqueNoMenu(controller1));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let recarregarBotaoEstavaPressionado = false;
let bodycamBotaoEstavaPressionado = false;
let ultimoEstadoBotoesDireita = [];

function handleControllerMovement() {
  const session = renderer.xr.getSession();
  if (!session) return;

  const speed = 0.15;
  const movimentoDesejado = new THREE.Vector3();

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

      movimentoDesejado.addScaledVector(direction, -y * speed);
      movimentoDesejado.addScaledVector(sideways, -x * speed);

      const buttonX = buttons[4]?.pressed;
      const buttonY = buttons[5]?.pressed;

      if (buttonY) movimentoDesejado.y += speed;
      if (buttonX) movimentoDesejado.y -= speed;
    }

    if (source.handedness === 'right') {
      // DEBUG: mostra todos os botões pressionados do controle direito,
      // só quando algum estado muda - ajuda a confirmar o índice certo
      // de cada botão no seu controle específico.
      const estadoAtualBotoes = buttons.map((b) => b.pressed);
      if (JSON.stringify(estadoAtualBotoes) !== JSON.stringify(ultimoEstadoBotoesDireita)) {
        console.log('[DEBUG botões direita] estado:', estadoAtualBotoes.map((p, i) => `${i}:${p ? 'PRESSIONADO' : '-'}`).join('  '));
        ultimoEstadoBotoesDireita = estadoAtualBotoes;
      }

      // Botão A do controle direito (índice 4) - liga/desliga a bodycam.
      const botaoBodycamPressionado = buttons[4]?.pressed || false;
      if (botaoBodycamPressionado && !bodycamBotaoEstavaPressionado) {
        ligarDesligarBodycam();
      }
      bodycamBotaoEstavaPressionado = botaoBodycamPressionado;

      // Botão B do controle direito (índice 5) - recarrega a arma.
      const botaoRecarregarPressionado = buttons[5]?.pressed || false;
      if (botaoRecarregarPressionado && !recarregarBotaoEstavaPressionado) {
        recarregar();
      }
      recarregarBotaoEstavaPressionado = botaoRecarregarPressionado;
    }
  }

  if (movimentoDesejado.lengthSq() === 0) return;

  characterController.computeColliderMovement(playerCollider, movimentoDesejado);
  const movimentoCorrigido = characterController.computedMovement();

  const posAtual = playerRigidBody.translation();
  playerRigidBody.setNextKinematicTranslation({
    x: posAtual.x + movimentoCorrigido.x,
    y: posAtual.y + movimentoCorrigido.y,
    z: posAtual.z + movimentoCorrigido.z,
  });
}

function sincronizarJogadorComFisica() {
  const t = playerRigidBody.translation();
  player.position.set(t.x, t.y - PLAYER_OFFSET_BASE, t.z);
}

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  atualizarVinhetaDeDano(delta);
  atualizarLuzDoTiro(delta);
  atualizarIndicadorDeAcerto(delta);

  // DEBUG_POSICAO: painel visual no canto da tela. Remover essa linha (e o
  // bloco debugPosPlano lá em cima) quando não precisar mais posicionar coisas.
  desenharDebugPosicao();

  atualizarAviso(delta);
  atualizarBriefing(delta);
  atualizarDeteccaoDeEstresse(delta);
  atualizarBodycam(delta);
  atualizarPainelDeEvidencia(delta);
  atualizarFlashDeCaptura(delta);

  handleControllerMovement();
  physicsWorld.step();
  sincronizarJogadorComFisica();
  if (mixerPorta) mixerPorta.update(delta);
  if (mixerTotem) mixerTotem.update(delta);
  if (mixerPortaBopeDireita) mixerPortaBopeDireita.update(delta);
  if (mixerPortaBopeEsquerda) mixerPortaBopeEsquerda.update(delta);
  if (mixerAlvos) mixerAlvos.update(delta);
  if (mixerCarroBope) mixerCarroBope.update(delta);
  if (mixerPoliciaSentado) mixerPoliciaSentado.update(delta);
  if (mixerBandidoVolta) mixerBandidoVolta.update(delta);
  if (mixerBandidoAnimado) mixerBandidoAnimado.update(delta);
  if (mixerBandido2Animado) mixerBandido2Animado.update(delta);
  if (mixerBondinho) mixerBondinho.update(delta);
  if (mixerBus) mixerBus.update(delta);
  atualizarFogo(delta);
  atualizarGranadas(delta);
  atualizarGranadaNaMao(delta);
  atualizarFogosDeArtificio(delta);
  atualizarEfeitosDeSangue(delta);
  verificarAreaDescida();
  renderer.render(scene, camera);
});