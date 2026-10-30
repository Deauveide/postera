/* ==========================================================
   app.js — arranque, UI y eventos de la experiencia AR
   FASE 1: un poster y un vídeo de prueba.
   En la Fase 2 la lista de posters pasa a js/posters.json.
   ========================================================== */

// ---------- Configuración global ----------
const CONFIG = {
  // Archivo compilado con los targets de TODOS los posters.
  // El orden de cada poster en la lista corresponde a su targetIndex.
  rutaTargets: 'assets/targets/targets.mind',

  // Filtrado de MindAR (One Euro filter). Ajustar aquí si el poster tiembla o va con retraso.
  //   filterMinCF: frecuencia de corte mínima. MENOR = menos temblor en reposo, pero más lento al arrancar.
  //   filterBeta:  sensibilidad a la velocidad. MAYOR = menos retraso al mover la cámara, más temblor.
  filtro: {
    filterMinCF: 0.001,
    filterBeta: 1000,
  },

  // Cuántos posters puede seguir MindAR a la vez. Con 1-2 posters visibles basta.
  // Subirlo consume más CPU/GPU en móviles.
  maxTrack: 1,

  // Límite del pixel ratio del renderer (ahorra GPU en móviles de alta densidad).
  pixelRatioMaximo: 2,

  // Tiempo máximo esperando a que MindAR arranque antes de mostrar error.
  tiempoLimiteArMs: 30000,
};

// Fase 1: un único poster de prueba. La Fase 2 lo moverá a js/posters.json.
const POSTERS = [
  {
    id: 'poster-prueba',
    targetIndex: 0,                  // posición de este poster dentro de targets.mind
    titulo: 'Poster de prueba',
    tipo: 'video',
    ruta: 'assets/media/video-prueba.mp4',
    escala: 1.0,                     // ancho del vídeo = ancho del poster (1 unidad de MindAR)
    posicion: '0 0 0.01',            // x y z relativos al centro del poster
    rotacion: '0 0 0',
    loop: true,
    enlace: null,
  },
];

// Mensajes para el usuario según el código de error
const MENSAJES = {
  SIN_HTTPS: 'La cámara solo funciona con HTTPS. Abre la página con una dirección que empiece por https://',
  NO_COMPATIBLE: 'Este navegador no permite usar la cámara en la web. Prueba con Safari en iOS o Chrome en Android.',
  PERMISO_DENEGADO: 'No diste permiso a la cámara. Actívalo en los ajustes del navegador y vuelve a intentarlo.',
  SIN_CAMARA: 'No encontramos una cámara en este dispositivo.',
  CAMARA_OCUPADA: 'La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.',
  CAMARA_FALLO: 'No se pudo acceder a la cámara. Vuelve a intentarlo.',
  ASSETS: 'No se pudieron cargar los archivos de la experiencia. Revisa tu conexión y vuelve a intentarlo.',
  TARGETS_PLACEHOLDER: 'Falta el archivo de reconocimiento (assets/targets/targets.mind). Hay que generarlo con las imágenes de los posters; ver README.',
  TIEMPO: 'La experiencia tardó demasiado en iniciarse. Vuelve a intentarlo.',
  GENERICO: 'Ocurrió un error inesperado.',
};

// ---------- Referencias al DOM y estado ----------
const $ = (id) => document.getElementById(id);

let escena = null;          // <a-scene> creada al pulsar el botón
let temporizadorAr = null;  // límite de tiempo mientras MindAR arranca

// ---------- Eventos ----------
$('btn-iniciar').addEventListener('click', iniciarExperiencia);
// Recargar la página es la forma más fiable de liberar cámara y escena en iOS/Android
$('btn-reintentar').addEventListener('click', () => location.reload());

// ---------- Flujo principal ----------
function iniciarExperiencia() {
  // IMPORTANTE (iOS): desbloquear los vídeos debe hacerse dentro del gesto del usuario,
  // de forma síncrona, ANTES de cualquier "await".
  const medios = crearVideos(POSTERS);
  desbloquearVideos(medios);

  mostrarCarga('Comprobando el dispositivo…');
  arrancar(medios).catch(mostrarError);
}

async function arrancar(medios) {
  comprobarCompatibilidad();

  mostrarCarga('Esperando permiso de cámara…');
  await pedirPermisoCamara();

  mostrarCarga('Cargando reconocimiento y animaciones…');
  await precargarAssets(medios);

  crearEscena(medios);
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
// Crea un <video> por poster de tipo "video". Empiezan silenciados (requisito de autoplay).
function crearVideos(posters) {
  const contenedor = $('medios');
  return posters
    .filter((p) => p.tipo === 'video')
    .map((p) => {
      const video = document.createElement('video');
      video.id = `video-${p.id}`;
      video.src = p.ruta;
      video.loop = p.loop;
      video.muted = true;        // se habilita el audio tras el toque del botón de inicio
      video.playsInline = true;  // iOS: reproducir dentro de la página, no a pantalla completa
      video.preload = 'auto';
      contenedor.appendChild(video);
      return { poster: p, video };
    });
}

// Dentro del gesto del usuario: intenta reproducir con sonido y pausa.
// Así el navegador permite reproducir después (con audio) cuando aparezca el poster.
// Si el navegador lo rechaza, el vídeo se queda silenciado.
function desbloquearVideos(medios) {
  medios.forEach(({ video }) => {
    video.muted = false;
    const promesa = video.play();
    if (promesa) {
      promesa
        .then(() => video.pause())
        .catch(() => {
          video.muted = true;
        });
    }
  });
}

// Espera a que el vídeo tenga datos suficientes (o falla con error claro)
function esperarVideo(video) {
  return new Promise((resolver, rechazar) => {
    if (video.readyState >= 2) return resolver();

    const limite = setTimeout(() => rechazar(errorApp('ASSETS', `timeout ${video.id}`)), 20000);
    video.addEventListener('loadeddata', () => {
      clearTimeout(limite);
      resolver();
    }, { once: true });
    video.addEventListener('error', () => {
      clearTimeout(limite);
      rechazar(errorApp('ASSETS', `error de vídeo ${video.id}`));
    }, { once: true });
  });
}

// ---------- Carga de assets ----------
async function precargarAssets(medios) {
  // 1) El archivo de targets: que exista y que no sea el placeholder sin generar
  let respuesta;
  try {
    respuesta = await fetch(CONFIG.rutaTargets);
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

  // 2) Los vídeos: esperamos a que tengan datos antes de crear la escena
  await Promise.all(medios.map(({ video }) => esperarVideo(video)));
}

// ---------- Escena A-Frame + MindAR ----------
function crearEscena(medios) {
  escena = document.createElement('a-scene');

  // Escena que ocupa su contenedor y sin botones nativos de VR/AR
  escena.setAttribute('embedded', '');
  escena.setAttribute('xr-mode-ui', { enabled: false });
  // Evita el permiso de orientación del dispositivo que iOS muestra al cargar A-Frame
  escena.setAttribute('device-orientation-permission-ui', { enabled: false });

  // Un solo renderer, sin antialias (ahorro en móviles); alpha para ver la cámara detrás
  escena.setAttribute('renderer', {
    antialias: false,
    alpha: true,
    colorManagement: true,
    precision: 'mediump',
  });

  // MindAR: un targets.mind para todos los posters, filtrado configurable.
  // Desactivamos sus pantallas propias (uiLoading/uiScanning/uiError): usamos las nuestras.
  escena.setAttribute('mindar-image', {
    imageTargetSrc: CONFIG.rutaTargets,
    maxTrack: CONFIG.maxTrack,
    filterMinCF: CONFIG.filtro.filterMinCF,
    filterBeta: CONFIG.filtro.filterBeta,
    uiLoading: 'no',
    uiScanning: 'no',
    uiError: 'no',
  });

  // Listeners antes de añadir la escena al DOM
  escena.addEventListener('renderstart', () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioMaximo);
    escena.renderer.setPixelRatio(pixelRatio);
  });
  escena.addEventListener('arReady', () => {
    clearTimeout(temporizadorAr);
    ocultarCarga();
  });
  escena.addEventListener('arError', (evento) => {
    clearTimeout(temporizadorAr);
    const detalle = evento.detail && evento.detail.error;
    mostrarError(errorApp(detalle === 'VIDEO_FAIL' ? 'CAMARA_FALLO' : 'GENERICO'));
  });

  medios.forEach(({ poster, video }) => escena.appendChild(crearPoster(poster, video)));

  $('contenedor-ar').appendChild(escena);

  // Si MindAR no arranca a tiempo, avisamos en lugar de quedarnos en la carga
  temporizadorAr = setTimeout(() => mostrarError(errorApp('TIEMPO')), CONFIG.tiempoLimiteArMs);
}

// Crea el ancla del poster (MindAR) con su contenido (vídeo) dentro
function crearPoster(poster, video) {
  const ancla = document.createElement('a-entity');
  ancla.id = `ancla-${poster.id}`;
  ancla.setAttribute('mindar-image-target', { targetIndex: poster.targetIndex });

  // Altura según la proporción real del vídeo: no se deforma
  const proporcion = video.videoHeight / video.videoWidth;

  const plano = document.createElement('a-video');
  plano.setAttribute('src', `#video-${poster.id}`);
  plano.setAttribute('width', poster.escala);
  plano.setAttribute('height', poster.escala * proporcion);
  plano.setAttribute('position', poster.posicion);
  plano.setAttribute('rotation', poster.rotacion);
  // Empieza invisible: se muestra con transición al encontrar el poster
  plano.setAttribute('material', { transparent: true, opacity: 0 });

  // Transiciones suaves (se disparan por evento, no al cargar)
  plano.setAttribute('animation__entrada', {
    property: 'material.opacity',
    from: 0,
    to: 1,
    dur: 400,
    easing: 'easeOutQuad',
    startEvents: 'mostrar',
    autoplay: false,
  });
  plano.setAttribute('animation__salida', {
    property: 'material.opacity',
    from: 1,
    to: 0,
    dur: 300,
    easing: 'easeInQuad',
    startEvents: 'ocultar',
    autoplay: false,
  });

  // Al encontrar el poster: reanudar vídeo y mostrar. Al perderlo: ocultar y pausar.
  ancla.addEventListener('targetFound', () => {
    video.play().catch(() => {});
    plano.emit('mostrar');
  });
  ancla.addEventListener('targetLost', () => {
    plano.emit('ocultar');
    video.pause();
  });

  ancla.appendChild(plano);
  return ancla;
}

// ---------- Interfaz ----------
function mostrarCarga(texto) {
  $('texto-carga').textContent = texto;
  $('pantalla-inicio').hidden = true;
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
  $('pantalla-inicio').hidden = true;
  $('estado-carga').hidden = true;
  $('estado-error').hidden = false;
}

// Crea un error con código para poder mostrar el mensaje adecuado
function errorApp(codigo, detalle) {
  const err = new Error(detalle || codigo);
  err.codigo = codigo;
  return err;
}
