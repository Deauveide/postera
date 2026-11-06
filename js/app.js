/* ==========================================================
   app.js — arranque, UI y eventos de la experiencia AR
   La lista de posters y los ajustes de MindAR viven en js/posters.json.
   ========================================================== */

// ---------- Ajustes generales (no dependen de los posters) ----------
const AJUSTES = {
  rutaConfiguracion: 'js/posters.json',
  rutaTargets: 'assets/targets/targets.mind',
  // Límite del pixel ratio del renderer (ahorra GPU en móviles de alta densidad)
  pixelRatioMaximo: 2,
  // Tiempo máximo esperando a que MindAR arranque antes de mostrar error
  tiempoLimiteArMs: 30000,
};

const TIPOS = ['video', 'image', 'model'];
const ANIMACIONES = ['ninguna', 'flotar', 'pulsar'];
const MOVIMIENTO_REDUCIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Alto/ancho de los posters (1080×1350 = 4:5). Solo se usa mientras llega el tamaño real del vídeo.
const PROPORCION_POSTER = 1350 / 1080;

// Mensajes para el usuario según el código de error
const MENSAJES = {
  SIN_HTTPS: 'La cámara solo funciona con HTTPS. Abre la página con una dirección que empiece por https://',
  NO_COMPATIBLE: 'Este navegador no permite usar la cámara en la web. Prueba con Safari en iOS o Chrome en Android.',
  PERMISO_DENEGADO: 'No diste permiso a la cámara. Actívalo en los ajustes del navegador y vuelve a intentarlo.',
  SIN_CAMARA: 'No encontramos una cámara en este dispositivo.',
  CAMARA_OCUPADA: 'La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.',
  CAMARA_FALLO: 'No se pudo acceder a la cámara. Vuelve a intentarlo.',
  ASSETS: 'No se pudieron cargar los archivos de la experiencia. Revisa tu conexión y vuelve a intentarlo.',
  CONFIG: 'La configuración de los posters (js/posters.json) tiene errores. Consulta la consola y el README.',
  TARGETS_PLACEHOLDER: 'Falta el archivo de reconocimiento (assets/targets/targets.mind). Hay que generarlo con las imágenes de los posters; ver README.',
  TIEMPO: 'La experiencia tardó demasiado en iniciarse. Vuelve a intentarlo.',
  GENERICO: 'Ocurrió un error inesperado.',
};

// Errores de cámara o compatibilidad: ofrecemos ver los posters sin cámara
const CODIGOS_SIN_CAMARA = ['SIN_HTTPS', 'NO_COMPATIBLE', 'PERMISO_DENEGADO', 'SIN_CAMARA', 'CAMARA_OCUPADA', 'CAMARA_FALLO'];

// ---------- Componente propio: reproducir los clips de un GLB en bucle ----------
// A-Frame 1.8 no incluye animation-mixer (eso viene de aframe-extras), así que usamos el
// AnimationMixer de three.js que ya trae A-Frame. Los clips llegan en model.animations.
if (window.AFRAME) {
  AFRAME.registerComponent('reproducir-clips', {
    init() {
      this.mezclador = null;
      this.el.addEventListener('model-loaded', () => this.iniciar());
    },
    iniciar() {
      const malla = this.el.getObject3D('mesh');
      if (!malla || !malla.animations || malla.animations.length === 0) return;
      this.mezclador = new AFRAME.THREE.AnimationMixer(malla);
      malla.animations.forEach((clip) => {
        this.mezclador.clipAction(clip).setLoop(AFRAME.THREE.LoopRepeat).play();
      });
    },
    tick(tiempo, delta) {
      if (this.mezclador) this.mezclador.update(delta / 1000);
    },
  });
}

// ---------- Referencias y estado ----------
const $ = (id) => document.getElementById(id);
const MODO_DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const MODO_SIN_CAMARA = new URLSearchParams(location.search).get('modo') === 'sin-camara';

let escena = null;              // <a-scene> creada al arrancar
let temporizadorAr = null;      // límite de tiempo mientras MindAR arranca
let medios = [];                // { poster, video } de cada poster de tipo "video"
let sonidoActivado = false;     // el audio necesita un toque del usuario (regla de los navegadores)
const postersVisibles = new Set();

// La configuración se pide en cuanto carga la página
const configuracionPromesa = cargarConfiguracion();

// ---------- Eventos ----------
$('btn-sin-camara-error').addEventListener('click', () => irSinCamara());
// Recargar la página es la forma más fiable de liberar cámara y escena en iOS/Android
$('btn-reintentar').addEventListener('click', () => location.reload());
$('btn-volver-inicio').addEventListener('click', () => { location.href = location.pathname; });
$('btn-sonido').addEventListener('click', activarSonido);
// Cualquier toque en la pantalla también activa el sonido
document.addEventListener('pointerdown', activarSonido);

// ---------- Arranque: sin botón, la experiencia se abre sola ----------
if (MODO_SIN_CAMARA) {
  mostrarSinCamara();
} else {
  arrancar().catch(mostrarError);
}

// ---------- Flujo principal ----------
// Todo lo que no depende entre sí va en paralelo: mientras el usuario acepta el permiso
// de cámara, ya se descargan la configuración, el archivo de targets y los vídeos.
async function arrancar() {
  comprobarCompatibilidad();

  // Los vídeos se crean en cuanto llega la configuración, para que empiecen a descargarse ya
  const mediosPromesa = configuracionPromesa.then((cfg) => {
    medios = crearMediosVideo(cfg);
    return medios;
  });

  const [cfg] = await Promise.all([
    configuracionPromesa,
    pedirPermisoCamara(),
    comprobarTargets(),
    mediosPromesa,
  ]);

  mostrarCarga('Preparando el reconocimiento…');
  await cargarImagenes(cfg);

  crearEscena(cfg, medios);
}

// ---------- Configuración ----------
async function cargarConfiguracion() {
  let respuesta;
  try {
    respuesta = await fetch(AJUSTES.rutaConfiguracion);
  } catch (err) {
    throw errorApp('ASSETS', 'No se pudo descargar js/posters.json');
  }
  if (!respuesta.ok) {
    throw errorApp('ASSETS', `posters.json respondió ${respuesta.status}`);
  }
  let configuracion;
  try {
    configuracion = await respuesta.json();
  } catch (err) {
    throw errorApp('CONFIG', 'posters.json no es JSON válido');
  }
  validarConfiguracion(configuracion);
  return configuracion;
}

// Comprueba la configuración antes de usarla. Un error aquí es más claro que uno dentro de A-Frame.
function validarConfiguracion(cfg) {
  const errores = [];
  if (!cfg || !Array.isArray(cfg.posters) || cfg.posters.length === 0) {
    throw errorApp('CONFIG', 'posters.json debe tener una lista "posters" con al menos un poster');
  }
  if (!Number.isInteger(cfg.maxTrack) || cfg.maxTrack < 1) {
    errores.push('maxTrack debe ser un entero mayor o igual a 1');
  }
  const f = cfg.filtro || {};
  if (typeof f.filterMinCF !== 'number' || typeof f.filterBeta !== 'number') {
    errores.push('filtro.filterMinCF y filtro.filterBeta deben ser números');
  }

  const ids = new Set();
  const indices = new Set();
  cfg.posters.forEach((p, i) => {
    const etiqueta = `posters[${i}]`;
    if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) {
      errores.push(`${etiqueta}.id debe usar solo minúsculas, números y guiones`);
    } else if (ids.has(p.id)) {
      errores.push(`${etiqueta}.id repetido: ${p.id}`);
    }
    ids.add(p.id);

    if (!Number.isInteger(p.targetIndex) || p.targetIndex < 0) {
      errores.push(`${etiqueta}.targetIndex debe ser un entero mayor o igual a 0`);
    } else if (indices.has(p.targetIndex)) {
      errores.push(`${etiqueta}.targetIndex repetido: ${p.targetIndex}`);
    }
    indices.add(p.targetIndex);

    if (!TIPOS.includes(p.tipo)) errores.push(`${etiqueta}.tipo debe ser video, image o model`);
    if (typeof p.ruta !== 'string' || p.ruta === '') errores.push(`${etiqueta}.ruta es obligatoria`);
    if (typeof p.escala !== 'number' || p.escala <= 0) errores.push(`${etiqueta}.escala debe ser un número mayor que 0`);
    if (typeof p.posicion !== 'string' || typeof p.rotacion !== 'string') {
      errores.push(`${etiqueta}.posicion y rotacion deben ser texto, por ejemplo "0 0 0.01"`);
    }
    if (p.animacion !== undefined && !ANIMACIONES.includes(p.animacion)) {
      errores.push(`${etiqueta}.animacion debe ser ninguna, flotar o pulsar`);
    }
  });

  if (errores.length > 0) {
    console.error('[Posters AR] posters.json:', errores);
    throw errorApp('CONFIG', errores.join(' · '));
  }
}

// ---------- Comprobaciones previas ----------
function comprobarCompatibilidad() {
  if (!window.isSecureContext) {
    throw errorApp('SIN_HTTPS');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw errorApp('NO_COMPATIBLE');
  }
  // Si las librerías de /vendor no cargaron (ruta mal o archivo ausente), avisamos claro
  if (typeof AFRAME === 'undefined' || !AFRAME.components['mindar-image']) {
    throw errorApp('ASSETS', 'Librerías A-Frame/MindAR no cargadas');
  }
}

// Pide el permiso de cámara. Cerramos el stream enseguida porque MindAR abre el suyo.
async function pedirPermisoCamara() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment' },
    });
  } catch (err) {
    throw traducirErrorCamara(err);
  }
  stream.getTracks().forEach((pista) => pista.stop());
}

function traducirErrorCamara(err) {
  const nombre = err && err.name;
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return errorApp('PERMISO_DENEGADO');
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return errorApp('SIN_CAMARA');
  if (nombre === 'NotReadableError' || nombre === 'AbortError') return errorApp('CAMARA_OCUPADA');
  return errorApp('CAMARA_FALLO', err && err.message);
}

// ---------- Vídeos ----------
// Crea un <video> por poster de tipo "video". Empiezan silenciados: así el navegador
// permite reproducirlos sin que el usuario toque nada (regla de autoplay de iOS y Android).
function crearMediosVideo(cfg) {
  const contenedor = $('medios');
  return cfg.posters.filter((p) => p.tipo === 'video').map((p) => {
    const video = document.createElement('video');
    video.id = `video-${p.id}`;
    video.src = p.ruta;
    video.loop = p.loop !== false;
    video.muted = true;        // el audio se activa con el primer toque (activarSonido)
    video.playsInline = true;  // iOS: reproducir dentro de la página, no a pantalla completa
    video.preload = 'auto';
    video.addEventListener('error', () => {
      console.error('[Posters AR]', 'No se pudo cargar el vídeo', p.ruta);
    });
    contenedor.appendChild(video);
    calentarVideo(p, video);
    return { poster: p, video };
  });
}

// iOS ignora preload="auto": un play() silenciado seguido de pause() obliga a descargar
// y decodificar el primer fotograma. Así el vídeo aparece al instante al detectar el poster.
function calentarVideo(poster, video) {
  const promesa = video.play();
  if (!promesa) return;
  promesa
    .then(() => { if (!postersVisibles.has(poster.id)) video.pause(); })
    .catch(() => {});
}

// Primer toque del usuario: quita el silencio de los vídeos. Debe ocurrir dentro del gesto.
// En iOS, play() con sonido dentro del toque "desbloquea" cada vídeo para más adelante.
function activarSonido() {
  if (sonidoActivado || medios.length === 0) return;
  sonidoActivado = true;
  $('btn-sonido').hidden = true;
  document.removeEventListener('pointerdown', activarSonido);

  medios.forEach(({ poster, video }) => {
    video.muted = false;
    const promesa = video.play();
    if (!promesa) return;
    promesa
      .then(() => { if (!postersVisibles.has(poster.id)) video.pause(); })
      .catch(() => {
        // El navegador no dejó usar el audio: el vídeo sigue, pero silenciado
        video.muted = true;
        if (postersVisibles.has(poster.id)) video.play().catch(() => {});
      });
  });
}

// Carga una imagen y devuelve sus dimensiones (para conservar la proporción)
function cargarImagen(ruta) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => resolver({ ancho: img.naturalWidth, alto: img.naturalHeight });
    img.onerror = () => rechazar(errorApp('ASSETS', `imagen ${ruta}`));
    img.src = ruta;
  });
}

// ---------- Carga de assets ----------
// Antes de crear la escena solo se comprueba el archivo de targets y se cargan las imágenes.
// Los vídeos NO se esperan: se descargan en paralelo y el plano se ajusta cuando llegan.
// Los modelos GLB (pesados) se cargan más tarde, al detectar su poster.

// Comprueba que targets.mind exista y no sea el placeholder sin generar.
// Se lee el archivo completo: queda en la caché del navegador y MindAR lo reutiliza.
async function comprobarTargets() {
  let respuesta;
  try {
    respuesta = await fetch(AJUSTES.rutaTargets);
  } catch (err) {
    throw errorApp('ASSETS', 'No se pudo descargar targets.mind');
  }
  if (!respuesta.ok) {
    throw errorApp('ASSETS', `targets.mind respondió ${respuesta.status}`);
  }
  const cabecera = new TextDecoder().decode((await respuesta.arrayBuffer()).slice(0, 11));
  if (cabecera === 'PLACEHOLDER') {
    throw errorApp('TARGETS_PLACEHOLDER');
  }
}

// Imágenes (tipo "image"): guardamos sus dimensiones para la proporción del plano
async function cargarImagenes(configuracion) {
  await Promise.all(configuracion.posters
    .filter((p) => p.tipo === 'image')
    .map(async (p) => { p._dimensiones = await cargarImagen(p.ruta); }));
}

// ---------- Escena A-Frame + MindAR ----------
function crearEscena(configuracion, medios) {
  escena = document.createElement('a-scene');

  // Escena que ocupa su contenedor y sin botones nativos de VR/AR
  escena.setAttribute('embedded', '');
  escena.setAttribute('xr-mode-ui', { enabled: false });
  // Decodificador local para los GLB comprimidos con meshopt (sin CDN).
  // Es una opción del sistema gltf-model, así que va en la escena, no en cada modelo.
  escena.setAttribute('gltf-model', 'meshoptDecoderPath: vendor/meshopt_decoder.js');
  // Evita el permiso de orientación del dispositivo que iOS muestra al cargar A-Frame
  escena.setAttribute('device-orientation-permission-ui', { enabled: false });

  // Un solo renderer, sin antialias (ahorro en móviles); alpha para ver la cámara detrás.
  // Sintaxis de cadena: precision admite solo high | medium | low (no "mediump").
  escena.setAttribute('renderer', 'antialias: false; alpha: true; colorManagement: true; precision: medium');

  // MindAR: un targets.mind para todos los posters. El filtro es de la escena, no de cada poster.
  const f = configuracion.filtro;
  const atributosMindAr = {
    imageTargetSrc: AJUSTES.rutaTargets,
    maxTrack: configuracion.maxTrack,
    filterMinCF: f.filterMinCF,
    filterBeta: f.filterBeta,
    uiLoading: 'no',   // usamos nuestras pantallas
    uiScanning: 'no',
    uiError: 'no',
    // Nota: no usamos showStats de MindAR: en 1.2.5 necesita una variable global "Stats"
    // que el bundle no incluye, y eso impide arrancar. El modo debug usa <a-scene stats>.
  };
  // -1 significa "valor por defecto de MindAR": solo enviamos los que se ajustan
  if (f.missTolerance !== undefined && f.missTolerance !== -1) atributosMindAr.missTolerance = f.missTolerance;
  if (f.warmupTolerance !== undefined && f.warmupTolerance !== -1) atributosMindAr.warmupTolerance = f.warmupTolerance;
  escena.setAttribute('mindar-image', atributosMindAr);

  // ?debug=1: FPS de A-Frame en pantalla (estadística integrada, sin librerías extra)
  if (MODO_DEBUG) {
    escena.setAttribute('stats', '');
  }

  // Listeners antes de añadir la escena al DOM
  escena.addEventListener('renderstart', () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, AJUSTES.pixelRatioMaximo);
    escena.renderer.setPixelRatio(pixelRatio);
  });
  escena.addEventListener('arReady', () => {
    clearTimeout(temporizadorAr);
    ocultarCarga();
    asegurarVideoCamara();
    $('capa-ar').hidden = false;
    $('btn-sonido').hidden = sonidoActivado || medios.length === 0;
  });
  escena.addEventListener('arError', (evento) => {
    clearTimeout(temporizadorAr);
    const detalle = evento.detail && evento.detail.error;
    mostrarError(errorApp(detalle === 'VIDEO_FAIL' ? 'CAMARA_FALLO' : 'GENERICO'));
  });

  // Cámara explícita: MindAR busca un <a-camera> para ajustar el campo de visión
  // a la cámara real. Sin ella, arReady nunca se dispara.
  const camara = document.createElement('a-camera');
  camara.setAttribute('position', '0 0 0');
  camara.setAttribute('look-controls', 'enabled: false');
  escena.appendChild(camara);

  const videos = new Map(medios.map(({ poster, video }) => [poster.id, video]));
  configuracion.posters.forEach((poster) => {
    escena.appendChild(crearPoster(poster, videos.get(poster.id)));
  });

  $('contenedor-ar').appendChild(escena);

  // Si MindAR no arranca a tiempo, avisamos en lugar de quedarnos en la carga
  temporizadorAr = setTimeout(() => mostrarError(errorApp('TIEMPO')), AJUSTES.tiempoLimiteArMs);
}

// Crea el ancla del poster (MindAR) con su contenido dentro, según el tipo
function crearPoster(poster, video) {
  const ancla = document.createElement('a-entity');
  ancla.id = `ancla-${poster.id}`;
  ancla.setAttribute('mindar-image-target', { targetIndex: poster.targetIndex });

  // Visibilidad común a todos los tipos: aviso de escaneo y registro de depuración
  ancla.addEventListener('targetFound', () => {
    postersVisibles.add(poster.id);
    registrarDeteccion(poster, 'encontrado');
    actualizarAvisoEscaneo();
  });
  ancla.addEventListener('targetLost', () => {
    postersVisibles.delete(poster.id);
    registrarDeteccion(poster, 'perdido');
    actualizarAvisoEscaneo();
  });

  if (poster.tipo === 'video') {
    crearContenidoVideo(ancla, poster, video);
  } else if (poster.tipo === 'image') {
    crearContenidoImagen(ancla, poster);
  } else if (poster.tipo === 'model') {
    crearContenidoModelo(ancla, poster);
  }

  return ancla;
}

// Vídeo: plano con la proporción real del vídeo, fade al aparecer, pausa al perder el poster
function crearContenidoVideo(ancla, poster, video) {
  const plano = document.createElement('a-video');
  plano.setAttribute('src', `#video-${poster.id}`);
  plano.setAttribute('width', poster.escala);
  plano.setAttribute('position', poster.posicion);
  plano.setAttribute('rotation', poster.rotacion);
  plano.setAttribute('material', { transparent: true, opacity: 0 });
  anadirFundido(plano);

  // Proporción real del vídeo. Si aún no llegaron sus datos, se usa la del poster (4:5)
  // y se corrige en cuanto el navegador conoce el tamaño del vídeo.
  const ajustarAlto = () => {
    plano.setAttribute('height', poster.escala * (video.videoHeight / video.videoWidth));
  };
  if (video.readyState >= 1 && video.videoWidth > 0) {
    ajustarAlto();
  } else {
    plano.setAttribute('height', poster.escala * PROPORCION_POSTER);
    video.addEventListener('loadedmetadata', ajustarAlto, { once: true });
  }

  ancla.addEventListener('targetFound', () => {
    video.play().catch(() => {});
    plano.emit('mostrar');
  });
  ancla.addEventListener('targetLost', () => {
    plano.emit('ocultar');
    video.pause();
  });

  ancla.appendChild(plano);
}

// Salvaguarda: MindAR confía en el autoplay de su <video> de cámara. Si el navegador lo dejó
// en pausa, sin imagen no hay reconocimiento: lo reanudamos (y lo reintentamos en el primer toque).
function asegurarVideoCamara() {
  const camara = $('contenedor-ar').querySelector(':scope > video');
  if (!camara || !camara.paused) return;
  camara.play().catch(() => {
    document.addEventListener('pointerdown', () => camara.play().catch(() => {}), { once: true });
  });
}

// Muestra "Apunta la cámara a un poster" solo cuando no se ve ninguno
function actualizarAvisoEscaneo() {
  $('aviso-escaneo').hidden = postersVisibles.size > 0;
}

// Modo debug: registra cada detección y pérdida con su hora, para medir la estabilidad en el móvil
function registrarDeteccion(poster, evento) {
  if (!MODO_DEBUG) return;
  console.info(`[Posters AR] ${poster.id} ${evento} · ${Math.round(performance.now())} ms`);
}

// Imagen (PNG con transparencia): fade + animación opcional (flotar o pulsar)
function crearContenidoImagen(ancla, poster) {
  const { ancho, alto } = poster._dimensiones;
  const plano = document.createElement('a-image');
  plano.setAttribute('src', poster.ruta);
  plano.setAttribute('width', poster.escala);
  plano.setAttribute('height', poster.escala * (alto / ancho));
  plano.setAttribute('position', poster.posicion);
  plano.setAttribute('rotation', poster.rotacion);
  plano.setAttribute('material', { transparent: true, opacity: 0 });
  anadirFundido(plano);
  anadirAnimacion(plano, poster);

  ancla.addEventListener('targetFound', () => plano.emit('mostrar'));
  ancla.addEventListener('targetLost', () => plano.emit('ocultar'));

  ancla.appendChild(plano);
}

// Modelo GLB: se crea la primera vez que aparece el poster (carga diferida)
function crearContenidoModelo(ancla, poster) {
  let modelo = null;
  ancla.addEventListener('targetFound', () => {
    if (modelo) return;
    modelo = document.createElement('a-gltf-model');
    modelo.setAttribute('src', poster.ruta);
    modelo.setAttribute('scale', `${poster.escala} ${poster.escala} ${poster.escala}`);
    modelo.setAttribute('position', poster.posicion);
    modelo.setAttribute('rotation', poster.rotacion);
    // Reproduce todos los clips del modelo en bucle (si el GLB no tiene clips, no pasa nada)
    modelo.setAttribute('reproducir-clips', '');
    ancla.appendChild(modelo);
  });
}

// Fade de entrada y salida, disparado por eventos "mostrar" y "ocultar"
function anadirFundido(elemento) {
  const duracionEntrada = MOVIMIENTO_REDUCIDO ? 0 : 200;
  const duracionSalida = MOVIMIENTO_REDUCIDO ? 0 : 300;
  elemento.setAttribute('animation__entrada', {
    property: 'material.opacity',
    from: 0,
    to: 1,
    dur: duracionEntrada,
    easing: 'easeOutQuad',
    startEvents: 'mostrar',
    autoplay: false,
  });
  elemento.setAttribute('animation__salida', {
    property: 'material.opacity',
    from: 1,
    to: 0,
    dur: duracionSalida,
    easing: 'easeInQuad',
    startEvents: 'ocultar',
    autoplay: false,
  });
}

// Animación en bucle de una imagen. Con "prefers-reduced-motion" no se mueve nada.
function anadirAnimacion(elemento, poster) {
  if (MOVIMIENTO_REDUCIDO || !poster.animacion || poster.animacion === 'ninguna') return;

  if (poster.animacion === 'flotar') {
    const [x, y, z] = poster.posicion.split(/\s+/).map(Number);
    elemento.setAttribute('animation__flotar', {
      property: 'position',
      from: `${x} ${y - 0.02} ${z}`,
      to: `${x} ${y + 0.02} ${z}`,
      dir: 'alternate',
      dur: 2000,
      easing: 'easeInOutSine',
      loop: true,
    });
  } else if (poster.animacion === 'pulsar') {
    elemento.setAttribute('animation__pulsar', {
      property: 'scale',
      from: '1 1 1',
      to: '1.05 1.05 1.05',
      dir: 'alternate',
      dur: 1200,
      easing: 'easeInOutSine',
      loop: true,
    });
  }
}

// ---------- Modo sin cámara ----------
// Muestra cada poster con su imagen original y su vídeo, sin AR.
// Se abre con ?modo=sin-camara o desde el botón de la pantalla de error.
function irSinCamara() {
  location.href = `${location.pathname}?modo=sin-camara`;
}

async function mostrarSinCamara() {
  mostrarCarga('Cargando los posters…');
  let configuracion;
  try {
    configuracion = await configuracionPromesa;
  } catch (err) {
    mostrarError(err);
    return;
  }

  const lista = $('lista-sin-camara');
  lista.replaceChildren();
  configuracion.posters.forEach((poster) => lista.appendChild(crearTarjetaSinCamara(poster)));

  $('estado-carga').hidden = true;
  $('modo-sin-camara').hidden = false;
}

function crearTarjetaSinCamara(poster) {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'tarjeta-poster';

  const titulo = document.createElement('h2');
  titulo.textContent = poster.titulo;
  tarjeta.appendChild(titulo);

  if (poster.tipo === 'video') {
    const video = document.createElement('video');
    video.src = poster.ruta;
    video.controls = true;
    video.playsInline = true;
    video.loop = poster.loop !== false;
    video.preload = 'metadata';
    video.setAttribute('aria-label', `Vídeo del ${poster.titulo}`);
    tarjeta.appendChild(video);
  } else if (poster.imagen) {
    const img = document.createElement('img');
    img.src = poster.imagen;
    img.alt = `Imagen del ${poster.titulo}`;
    img.loading = 'lazy';
    tarjeta.appendChild(img);
  }

  const nota = document.createElement('p');
  nota.className = 'nota-poster';
  nota.textContent = poster.tipo === 'video'
    ? 'Con la cámara, este vídeo aparece sobre el poster impreso.'
    : 'La animación de este poster solo se ve con la cámara.';
  tarjeta.appendChild(nota);

  return tarjeta;
}

// ---------- Interfaz ----------
function mostrarCarga(texto) {
  $('texto-carga').textContent = texto;
  $('estado-error').hidden = true;
  $('estado-carga').hidden = false;
}

function ocultarCarga() {
  $('estado-carga').hidden = true;
}

function mostrarError(err) {
  const codigo = (err && err.codigo) || 'GENERICO';
  console.error('[Posters AR]', codigo, err);
  $('texto-error').textContent = MENSAJES[codigo] || MENSAJES.GENERICO;
  $('btn-sin-camara-error').hidden = !CODIGOS_SIN_CAMARA.includes(codigo);
  $('estado-carga').hidden = true;
  $('capa-ar').hidden = true;
  $('estado-error').hidden = false;
}

// Crea un error con código para poder mostrar el mensaje adecuado
function errorApp(codigo, detalle) {
  const err = new Error(detalle || codigo);
  err.codigo = codigo;
  return err;
}
