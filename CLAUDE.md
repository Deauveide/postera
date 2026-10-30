# CLAUDE.md — Posters animados AR

Web de realidad aumentada: el usuario apunta la cámara a un poster impreso y aparece una animación (vídeo, modelo GLB o imagen animada). Todo corre en el navegador, sin backend. Se despliega en GitHub Pages o en un WordPress estático (HTTPS obligatorio para la cámara).

## Stack (versiones fijadas)

| Librería | Versión | Archivo en `/vendor` | Notas |
|---|---|---|---|
| A-Frame | **1.8.0** | `vendor/aframe-1.8.0.min.js` | Última estable en npm (publicada 2026-06-23). Verificada el 2026-10-30. |
| MindAR (`mind-ar`) | **1.2.5** | `vendor/mindar-image-aframe-1.2.5.prod.js` | Última en npm (publicada 2024-01-16). Bundle autocontenido: usa `AFRAME.THREE`. |

- **Riesgo conocido:** MindAR 1.2.5 es de 2024 y no se ha probado con A-Frame 1.8.0. Si el tracking o el renderer fallan en la prueba, probar una versión anterior de A-Frame (p. ej. 1.5.0) y anotar el resultado aquí.
- Nunca usar CDN en producción. Las librerías se descargan a `/vendor` con la versión en el nombre.
- Licencias (MIT) en `vendor/licenses/`.
- HTML, CSS y JS vanilla. Sin frameworks ni paso de build.

## Estructura

```
index.html                 Pantalla de inicio, estados de carga/error, contenedores
css/styles.css             Estilos (tokens de color en :root)
js/app.js                  Arranque, permisos, carga, escena y eventos
js/posters.json            (Fase 2) Configuración de cada poster
vendor/                    A-Frame y MindAR (+ licenses/)
assets/targets/targets.mind  Targets compilados (PLACEHOLDER hasta generar el real)
assets/posters/            Imágenes originales de los posters (referencia/compilación)
assets/media/              Vídeos (.mp4), modelos (.glb) e imágenes de animación
README.md                  Uso, pruebas, compilación de targets y despliegue
CLAUDE.md                  Este archivo
```

## Decisiones tomadas (Fase 1)

- **Un solo `targets.mind`** para todos los posters. El orden del array en `posters.json` debe coincidir con `targetIndex`.
- **Cámara bajo demanda:** nada de cámara hasta pulsar "Iniciar experiencia". Se pide permiso con `getUserMedia`, se cierra ese stream y MindAR abre el suyo. Así podemos distinguir "permiso denegado" de otros fallos.
- **Vídeo y audio:** el vídeo arranca silenciado (`muted` + `playsInline`). Dentro del toque del botón se hace un `play()` con sonido y `pause()` para desbloquear el audio en iOS. Si el navegador lo rechaza, el vídeo queda silenciado. **Verificar en iOS real.**
- **Proporción:** el plano del vídeo usa la proporción real del vídeo (`videoHeight / videoWidth`), no se deforma.
- **Escala:** 1 unidad de A-Frame = ancho del poster (así lo muestran los ejemplos de MindAR). **Confirmar en la prueba** con un poster real.
- **Transiciones:** al encontrar el poster, fade-in de 400 ms y `play()`. Al perderlo, fade-out de 300 ms y `pause()`.
- **UI nativa de MindAR desactivada** (`uiLoading`, `uiScanning`, `uiError` = `no`). Usamos nuestras pantallas.
- **Filtrado MindAR** en `CONFIG.filtro` de `app.js`: `filterMinCF = 0.001`, `filterBeta = 1000` (valores por defecto de MindAR, documentados allí).
- **`maxTrack`** = 1 (un poster visible a la vez). Subirlo solo si se necesitan varios a la vez.
- **Renderer:** un solo renderer, sin antialias, `alpha: true`, `mediump`, pixel ratio máximo 2. Sin sombras ni luces en Fase 1.
- **Recargar la página** es el "reintentar" del error: es la forma más fiable de liberar cámara y escena en iOS/Android.
- **Formato de los posters:** 1080×1350 px (proporción **4:5**). Impresión tamaño carta recortada; puede haber impresiones mayores (SuperB) con la misma proporción. Como la escala es relativa al ancho del poster, el tamaño impreso no cambia la configuración.
- **Test de Fase 1:** `assets/media/video-prueba.mp4` (H.264, 720×900 = 4:5, 8 s, muted) y `assets/posters/poster-prueba.png` (1080×1350, generado para pruebas). Ninguno es el contenido final.
- **Número de posters:** unos 6. Empezar con `maxTrack: 1`; revisar si hace falta más al probar.

## Convenciones de código

- Comentarios y textos de interfaz **en español**, con tildes correctas.
- Código simple y comentado. Sin dependencias nuevas sin motivo claro.
- Funciones pequeñas. Los errores se crean con `errorApp(codigo)` y se muestran con `MENSAJES[codigo]`.
- Accesibilidad: botones con texto visible, `role="status"` / `role="alert"` en los estados, foco visible, áreas táctiles de 52 px, texto alternativo en el icono de inicio.
- Sin `console.log` de depuración en el código final; los errores usan `console.error('[Posters AR]', ...)`.

## Comandos útiles

```bash
# Servidor local (desde la raíz del proyecto). Soporta Range requests, necesarios para vídeo en iOS.
npx serve -l 3000 .

# Túnel HTTPS para probar desde el móvil (la cámara exige HTTPS)
cloudflared tunnel --url http://localhost:3000
```

Comprobar que los archivos clave responden:

```bash
curl -I http://localhost:3000/vendor/aframe-1.8.0.min.js
curl -I http://localhost:3000/assets/targets/targets.mind
curl -I -H "Range: bytes=0-1023" http://localhost:3000/assets/media/video-prueba.mp4   # debe devolver 206
```

Comprobar la versión de las librerías en npm (antes de actualizar):

```bash
npm view aframe version
npm view mind-ar version
```

## Pendiente

- **Fase 2:** mover la configuración de `app.js` a `js/posters.json` y generar varios posters y tipos (`model`, `image`).
- **Fase 3:** mensajes de error completos, overlays "Ver más", pulido visual.
- **Fase 4:** optimización de peso, README final y guía de despliegue (GitHub Pages y WordPress con iframe `allow="camera; autoplay"`).
- **targets.mind real:** el archivo actual es un PLACEHOLDER. El usuario debe generarlo con sus imágenes reales (ver README).
- Script Node para compilar targets: **no verificado**. El paquete trae `offline-compiler.js`, pero depende de `canvas` y TensorFlow.js. Evaluar en Fase 4.
