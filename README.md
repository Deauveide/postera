# Posters animados AR

Apunta la cámara del móvil a un poster impreso y mira cómo cobra vida. Todo corre en el navegador, sin backend.

> **Estado: Fase 1.** Estructura, pantalla de inicio y una escena AR con un poster y un vídeo de prueba.
> Los apartados de despliegue completos llegan en la Fase 4.

## Requisitos

- Node.js 18 o superior (solo para el servidor local con `npx serve`).
- Un móvil con **Safari en iOS** o **Chrome en Android**, con cámara trasera.
- **HTTPS**: la cámara del navegador no funciona en HTTP. `localhost` sí cuenta como seguro en el ordenador.

## Estructura

```
index.html                   Pantalla de inicio y estados
css/styles.css               Estilos
js/app.js                    Lógica de arranque, permisos, carga y escena
js/posters.json              (Fase 2) Configuración de posters
vendor/                      A-Frame 1.8.0 y MindAR 1.2.5 (sin CDN)
assets/targets/targets.mind  Targets compilados de todos los posters (PLACEHOLDER: hay que generarlo)
assets/<poster>/             Todo el contenido de un poster: imagen, vídeos, modelos, imágenes animadas
docs/                        Documentación del proyecto (artículo de investigación)
```

Ver `CLAUDE.md` para versiones, decisiones técnicas y convenciones.

## Probar en local

1. Abre una terminal en la carpeta del proyecto.
2. Arranca el servidor estático:

   ```bash
   npx serve -l 3000 .
   ```

3. Abre `http://localhost:3000` en el ordenador. La página carga, pero la cámara solo funciona si el poster `targets.mind` ya es real (ver "Compilar los targets").

## Probar desde el móvil (HTTPS)

El móvil necesita HTTPS. Hay dos formas:

**Opción A: túnel HTTPS (recomendada).** Con el servidor del paso anterior en marcha, en otra terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Abre en el móvil la URL `https://...trycloudflare.com` que muestra la terminal. Si no tienes `cloudflared`, `ngrok http 3000` funciona igual.

**Opción B: red local sin HTTPS (solo pruebas en Chrome Android).** Abre `http://IP_DEL_PC:3000` en el móvil y activa en `chrome://flags` la opción `unsafely-treat-insecure-origin-as-secure` con esa dirección. Safari iOS no tiene equivalente: usa la opción A.

## Compilar los targets

El archivo `assets/targets/targets.mind` contiene el reconocimiento de **todos** los posters. Hoy es un **PLACEHOLDER** que la app detecta y explica. Hay que reemplazarlo con uno real.

Reglas:

- Las imágenes deben ser las **mismas** que se imprimen (mismo recorte, misma proporción).
- El **orden** de compilación debe coincidir con `targetIndex` de cada poster en la configuración. El poster 0 es el primero que subas, el 1 el segundo, y así.
- Usa imágenes con mucho detalle y contraste. Las superficies lisas o repetitivas se detectan mal.

### (a) Herramienta web oficial de MindAR (recomendada)

1. Abre la herramienta de compilación: <https://hiukim.github.io/mind-ar-js-doc/tools/compile>
2. Sube las imágenes de los posters **en el orden indicado**.
3. Espera a que termine y descarga el archivo `targets.mind`.
4. Copia el archivo a `assets/targets/targets.mind` y sustituye el placeholder.

### (b) Script Node (opcional, sin verificar)

El paquete `mind-ar` incluye `src/image-target/offline-compiler.js`, que en principio permite compilar desde Node. Depende de los paquetes `canvas` y `@tensorflow/tfjs`. **Todavía no está probado en este proyecto**, así que no lo uses como fuente fiable. Se evaluará en la Fase 4.

## Añadir un poster

1. Copia los assets a `assets/<id-del-poster>/` (nombres en minúsculas, sin espacios).
2. Compila el target del poster junto con los demás (ver "Compilar los targets") y pon el poster en la posición que le corresponda en `targets.mind`.
3. Añade su entrada en `js/posters.json`, con el mismo `targetIndex`. Los campos están descritos en `CLAUDE.md`.
4. Prueba en local: `npx serve -l 3000 .` y abre `http://localhost:3000/?debug=1`.

## Modos de la página

- `/` — inicio. Con cámara, el botón "Iniciar experiencia".
- `/?modo=sin-camara` — los posters sin cámara (imagen y vídeo).
- `/?debug=1` — muestra los FPS y registra en consola cada detección y pérdida con su hora.

## Despliegue

Pendiente de la Fase 4 (GitHub Pages y WordPress estático con iframe `allow="camera; autoplay"`).
