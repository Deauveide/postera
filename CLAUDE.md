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
js/posters.json            Configuración de posters y filtros de MindAR (ver sección abajo)
vendor/                    A-Frame y MindAR (+ licenses/)
assets/targets/targets.mind  Targets compilados de TODOS los posters (PLACEHOLDER hasta generar el real)
assets/<poster>/           Todo el contenido de UN poster (ver convención abajo)
assets/poster-1/           Poster 1 (primer poster real)
assets/poster-prueba/      Poster y vídeo de prueba de la Fase 1
docs/                      Documentación del proyecto (artículo de investigación en .docx)
README.md                  Uso, pruebas, compilación de targets y despliegue
CLAUDE.md                  Este archivo
```

## Convención de assets por poster

- Cada poster tiene **una carpeta** directamente dentro de `assets/`, con todo su contenido: imagen del poster, vídeos, modelos GLB, imágenes animadas.
- Nombres de carpeta y de archivo en **minúsculas, sin espacios ni símbolos** (`+`, `·`, tildes): dan problemas en URLs. Ejemplo: `poster-1/modelo.glb`, no `Sharp V3 · Multi View.glb`.
- `targets.mind` no va en la carpeta de un poster: se compila con todos juntos y vive en `assets/targets/`.
- Las rutas de `posters.json` apuntan a esta carpeta.
- Las carpetas de posters no se mueven ni se renombran sin actualizar `posters.json` y el `targets.mind`.

Estado actual de `assets/poster-1/`:

| Archivo | Original | Uso previsto |
|---|---|---|
| `poster.jpg` | Poster Objetivo Nazional (4500×5626, 4:5) | Imagen para compilar el target |
| `modelo.glb` | Sharp V3 · Multi View · Highest 3D model (originalmente 59 MB, ahora 2,9 MB) | Modelo (tipo `model`). **No tiene animaciones**: ver nota abajo |
| `texto-nazi.png` | Texto nazi (2209×672) | Imagen animada (tipo `image`) |
| `fenismo.png` | fenismo (1024×1024) | Imagen animada (tipo `image`) |
| `lgbtiq.png` | lgbtiq+ (1024×1024) | Imagen animada (tipo `image`) |

El uso de cada archivo en la animación lo define `posters.json`: estos usos son una suposición hasta confirmarlo.

### Optimización de `modelo.glb` (59 MB → 2,9 MB)

- **Revisión:** una sola malla de ~1 M de vértices (escaneo denso), 3 texturas de 2048×2048 (JPG/PNG), **0 animaciones**, 1 nodo, sin skins.
- **Cambios aplicados** con `@gltf-transform/cli` 4.5.1 (`optimize`): simplificación de malla al 25 % (`--simplify-ratio 0.25`, error 0.01), texturas a 1024 px en WebP, compresión **meshopt** y cuantización de atributos. El original sigue en `POSTERA.zip`.
- **Verificado en navegador** (A-Frame 1.8.0): carga en ~0,5 s y el aspecto visual frente al original es el mismo a tamaño de pantalla completa. No se ha revisado un zoom de detalle.
- **Decodificador meshopt:** A-Frame no incluye el decodificador y el GLB no carga sin él (`setMeshoptDecoder must be called…`). Se usa `vendor/meshopt_decoder.js` (módulo de three.js r184 convertido a script clásico, MIT, licencia en `vendor/licenses/meshopt-LICENSE.md`). Se configura una vez en la escena (`gltf-model="meshoptDecoderPath: vendor/meshopt_decoder.js"`) en `js/app.js`.
- **Descartado:** `quantize` sin meshopt pesa 11 MB al 25 %, mucho más que meshopt.
- **Pendiente:** el modelo no tiene animación. Si el poster necesita animación, hay que crearla en el DCC y reexportar, o decidir una animación en código (rotación, flotación) para tipo `model`. Confirmar con el usuario.

## Contexto del proyecto

- `docs/` contiene el artículo de investigación *"Diferencias en la efectividad comunicativa entre un póster convencional y uno que incorpora realidad aumentada"* (Institución Universitaria de Roldanillo, UNINTEP). Compara un póster estático con uno con RA, con un grupo focal de estudiantes.
- El poster y la experiencia forman parte de esa investigación: los cambios de contenido conviene anotarlos.

## Configuración: js/posters.json

- `maxTrack`: posters que MindAR sigue a la vez.
- `filtro`: ajustes de MindAR **de toda la escena** (no por poster; MindAR 1.2.5 no lo permite).
  - `filterMinCF`: menor = menos temblor en reposo, más retraso al moverse despacio.
  - `filterBeta`: mayor = menos retraso al moverse rápido.
  - `missTolerance`, `warmupTolerance`: frames que el poster se mantiene al perderlo / al encontrarlo. `-1` = valor por defecto de MindAR.
- `posters[]`: cada poster tiene `id` (minúsculas y guiones), `targetIndex` (único, orden en `targets.mind`), `titulo`, `imagen` (para el modo sin cámara), `tipo`, `ruta`, `escala` (ancho en unidades de MindAR), `posicion`, `rotacion`, `loop` (vídeo) y `animacion` (`ninguna`, `flotar` o `pulsar`, solo para `image`).
- Tipos:
  - `video`: vídeo H.264 con fade y pausa al perder el poster.
  - `image`: PNG con transparencia; `flotar` o `pulsar` en bucle.
  - `model`: GLB. Se carga la primera vez que aparece el poster. Reproduce todos sus clips en bucle con el componente `reproducir-clips` (A-Frame 1.8 no trae `animation-mixer`).
- `js/app.js` valida la configuración al arrancar. Un error de validación muestra un aviso y lista los campos en la consola.

## Modos y depuración

- **Sin cámara:** `?modo=sin-camara` (también desde los botones de inicio y de error). Muestra cada poster con su imagen y su vídeo.
- **Debug:** `?debug=1` muestra el FPS de A-Frame (`<a-scene stats>`) y registra en consola cada detección y pérdida con su hora.
- **No usar `showStats` de MindAR:** en 1.2.5 necesita una variable global `Stats` que el bundle no incluye, y la escena no llega a arrancar.
- **`prefers-reduced-motion`:** se desactivan los fades largos y las animaciones en bucle de `image`.

## Decisiones tomadas (Fase 1)

- **Un solo `targets.mind`** para todos los posters. El orden del array en `posters.json` debe coincidir con `targetIndex`.
- **Cámara bajo demanda:** nada de cámara hasta pulsar "Iniciar experiencia". Se pide permiso con `getUserMedia`, se cierra ese stream y MindAR abre el suyo. Así podemos distinguir "permiso denegado" de otros fallos.
- **Vídeo y audio:** el vídeo arranca silenciado (`muted` + `playsInline`). Dentro del toque del botón se hace un `play()` con sonido y `pause()` para desbloquear el audio en iOS. Si el navegador lo rechaza, el vídeo queda silenciado. **Verificar en iOS real.**
- **Proporción:** el plano del vídeo usa la proporción real del vídeo (`videoHeight / videoWidth`), no se deforma.
- **Escala:** 1 unidad de A-Frame = ancho del poster (así lo muestran los ejemplos de MindAR). **Confirmar en la prueba** con un poster real.
- **Transiciones:** al encontrar el poster, fade-in de 400 ms y `play()`. Al perderlo, fade-out de 300 ms y `pause()`.
- **UI nativa de MindAR desactivada** (`uiLoading`, `uiScanning`, `uiError` = `no`). Usamos nuestras pantallas.
- **`<a-camera>` obligatoria:** MindAR busca un `<a-camera>` dentro de la escena para ajustar el campo de visión (`_resize`). Sin ella, `arReady` nunca se dispara y la app se queda en la carga hasta el timeout. Está en `crearEscena()`.
- **Filtrado MindAR** en `CONFIG.filtro` de `app.js`: `filterMinCF = 0.001`, `filterBeta = 1000` (valores por defecto de MindAR, documentados allí).
- **`maxTrack`** = 1 (un poster visible a la vez). Subirlo solo si se necesitan varios a la vez.
- **Renderer:** un solo renderer, sin antialias, `alpha: true`, `precision: medium` (no `mediump`), pixel ratio máximo 2. Sin sombras ni luces en Fase 1.
- **Recargar la página** es el "reintentar" del error: es la forma más fiable de liberar cámara y escena en iOS/Android.
- **Formato de los posters:** 1080×1350 px (proporción **4:5**). Impresión tamaño carta recortada; puede haber impresiones mayores (SuperB) con la misma proporción. Como la escala es relativa al ancho del poster, el tamaño impreso no cambia la configuración.
- **Test de Fase 1:** `assets/poster-prueba/video.mp4` (H.264, 720×900 = 4:5, 8 s, muted) y `assets/poster-prueba/poster.png` (1080×1350, generado para pruebas). Ninguno es el contenido final.
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
curl -I -H "Range: bytes=0-1023" http://localhost:3000/assets/poster-prueba/video.mp4   # debe devolver 206
```

Comprobar la versión de las librerías en npm (antes de actualizar):

```bash
npm view aframe version
npm view mind-ar version
```

## Pendiente

- **Posters 2 a 6:** añadir cada uno a `posters.json` cuando estén sus assets y su target compilado (el `.mind` se compila con todos, en el orden de `targetIndex`).
- **Fase 3:** overlays "Ver más" y pulido visual.
- **Medición (punto 7 de la lista de mejoras):** no implementada. Antes hay que definir qué se mide, con quién y con consentimiento.
- **Fase 3:** mensajes de error completos, overlays "Ver más", pulido visual.
- **Fase 4:** optimización de peso, README final y guía de despliegue (GitHub Pages y WordPress con iframe `allow="camera; autoplay"`).
- **targets.mind real:** el archivo actual es un PLACEHOLDER. El usuario debe generarlo con sus imágenes reales (ver README).
- Script Node para compilar targets: **no verificado**. El paquete trae `offline-compiler.js`, pero depende de `canvas` y TensorFlow.js. Evaluar en Fase 4.
