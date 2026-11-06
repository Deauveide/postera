/* ==========================================================
   cartas-del-alma.js — escena Three.js de la postal "Roldanillo 2026"
   Proyecto "Cartas del Alma" · Asamblea Popular

   Postal pop-up: al detectar la postal, cada elemento (toldo, letrero, mujer,
   león, rosas) se despega del papel y sube a su propia altura. Al mover el móvil
   se ve el parallax real entre capas. Después brotan pétalos de las rosas, la
   flecha del letrero se desliza y el logotipo "Cartas del Alma" aparece en 3D.

   Uso en A-Frame:  <a-entity escena-cartas-del-alma="ruta: assets/poster-3/"></a-entity>
   Eventos que escucha: "mostrar" (poster detectado) y "ocultar" (poster perdido).

   Los datos vienen de herramientas/postal-roldanillo/preparar_capas.py:
   capas.json (posición de cada capa) y logo.json (contornos del logotipo).
   Unidades: 1 = ancho de la postal; el origen es el centro de la postal (como MindAR).
   ========================================================== */
(function () {
  const THREE = AFRAME.THREE;
  const MOVIMIENTO_REDUCIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Línea de tiempo (segundos desde la detección) ----------
  const T = {
    base: 0.35,          // el fondo aparece
    subida: 0.9,         // lo que tarda cada capa en elevarse
    petalos: 2.0,        // empiezan a brotar pétalos
    logo: 2.3,           // entra el logotipo
    logoDuracion: 1.2,
    finIntro: 3.6,       // a partir de aquí todo es bucle
    reinicio: 6,         // si el poster estuvo perdido más que esto, la intro se repite
  };
  const NUM_PETALOS = 48;
  const ROJO_LOGO = '#b5121b';
  const ROJO_LADO = '#6e0a10';

  // ---------- Utilidades de animación ----------
  const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const progreso = (t, inicio, dur) => limitar((t - inicio) / dur);
  const suavizar = (p) => p * p * (3 - 2 * p);
  // Sale con un pequeño rebote (pop-up)
  function rebote(p) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  }
  // Número pseudoaleatorio fijo por índice: los pétalos son iguales en cada visita
  const azar = (i, s) => {
    const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  function cargarTextura(cargador, url) {
    return new Promise((resolver, rechazar) => {
      cargador.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolver(tex);
      }, undefined, rechazar);
    });
  }

  AFRAME.registerComponent('escena-cartas-del-alma', {
    schema: {
      ruta: { type: 'string', default: 'assets/poster-3/' },
    },

    init() {
      this.t = 0;                 // reloj de la escena (solo avanza mientras se ve el poster)
      this.activo = false;
      this.perdidoEn = null;
      this.listo = false;
      this.grupo = new THREE.Group();
      this.grupo.visible = false;
      this.el.setObject3D('postal', this.grupo);

      this.el.addEventListener('mostrar', () => this.mostrar());
      this.el.addEventListener('ocultar', () => this.ocultar());

      this.cargar().catch((err) => console.error('[Posters AR]', 'Escena Cartas del Alma:', err));
    },

    async cargar() {
      const ruta = this.data.ruta.endsWith('/') ? this.data.ruta : `${this.data.ruta}/`;
      const [capas, logo] = await Promise.all([
        fetch(`${ruta}capas.json`).then((r) => r.json()),
        fetch(`${ruta}logo.json`).then((r) => r.json()),
      ]);
      const cargador = new THREE.TextureLoader();
      const [texBase, ...texCapas] = await Promise.all([
        cargarTextura(cargador, `${ruta}capas/base.jpg`),
        ...capas.capas.map((c) => cargarTextura(cargador, ruta + c.archivo)),
      ]);

      this.proporcion = capas.proporcion;
      this.crearBase(texBase);
      this.capas = capas.capas.map((c, i) => this.crearCapa(c, texCapas[i], i));
      this.crearPetalos(capas.capas.find((c) => c.nombre === 'rosas'));
      this.crearLogo(logo);
      this.listo = true;
      this.actualizar(this.t);
    },

    // Fondo: la postal sin los elementos que se elevan. Tapa exactamente la postal impresa.
    crearBase(textura) {
      const material = new THREE.MeshBasicMaterial({ map: textura, transparent: true, opacity: 0 });
      this.base = new THREE.Mesh(new THREE.PlaneGeometry(1, this.proporcion), material);
      this.base.position.z = 0.001;
      this.base.renderOrder = 0;
      this.grupo.add(this.base);
    },

    // Cada capa: el recorte + una sombra suave proyectada sobre el papel
    crearCapa(datos, textura, i) {
      const geometria = new THREE.PlaneGeometry(datos.ancho, datos.alto);

      const sombra = new THREE.Mesh(geometria, new THREE.MeshBasicMaterial({
        map: textura, color: 0x2a1a10, transparent: true, opacity: 0, depthWrite: false,
      }));
      sombra.position.set(datos.x, datos.y, 0.002 + i * 0.0002);
      sombra.renderOrder = 1;

      const pieza = new THREE.Mesh(geometria, new THREE.MeshBasicMaterial({
        map: textura, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      pieza.position.set(datos.x, datos.y, 0.003 + i * 0.0005);
      pieza.renderOrder = 10 + i;

      this.grupo.add(sombra, pieza);
      return { datos, pieza, sombra, i };
    },

    // Pétalos: una sola malla instanciada (barata en móvil)
    crearPetalos(rosas) {
      const forma = new THREE.Shape();
      forma.moveTo(0, -0.5);
      forma.bezierCurveTo(0.55, -0.25, 0.5, 0.35, 0, 0.5);
      forma.bezierCurveTo(-0.5, 0.35, -0.55, -0.25, 0, -0.5);
      const geometria = new THREE.ShapeGeometry(forma, 6);
      geometria.scale(0.04, 0.055, 1);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      this.petalos = new THREE.InstancedMesh(geometria, material, NUM_PETALOS);
      this.petalos.renderOrder = 30;
      this.petalos.frustumCulled = false;
      const tonos = ['#c8202e', '#a8121f', '#e0384a', '#8f0d18', '#d42a3a'];
      const color = new THREE.Color();
      for (let i = 0; i < NUM_PETALOS; i++) {
        this.petalos.setColorAt(i, color.set(tonos[i % tonos.length]));
      }
      this.rosas = rosas;
      this.auxPetalo = new THREE.Object3D();
      this.grupo.add(this.petalos);
    },

    // Logotipo "Cartas del Alma" extruido a partir de sus contornos vectoriales
    crearLogo(logo) {
      const aForma = (puntos) => puntos.map(([x, y]) => new THREE.Vector2(x, y));
      const formas = logo.formas.map((f) => {
        const forma = new THREE.Shape(aForma(f.contorno));
        forma.holes = f.huecos.map((h) => new THREE.Path(aForma(h)));
        return forma;
      });
      const geometria = new THREE.ExtrudeGeometry(formas, {
        depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4,
      });
      geometria.translate(0, 0, -0.029);
      const materiales = [
        new THREE.MeshBasicMaterial({ color: ROJO_LOGO }),   // caras
        new THREE.MeshBasicMaterial({ color: ROJO_LADO }),   // laterales (da volumen sin luces)
      ];
      const malla = new THREE.Mesh(geometria, materiales);
      malla.renderOrder = 40;

      // Placa crema detrás del texto: se lee sobre cualquier fondo de cámara
      const ancho = 1.12, alto = logo.proporcion + 0.16;
      const placaForma = new THREE.Shape();
      const r = 0.06;
      placaForma.moveTo(-ancho / 2 + r, -alto / 2);
      placaForma.lineTo(ancho / 2 - r, -alto / 2);
      placaForma.quadraticCurveTo(ancho / 2, -alto / 2, ancho / 2, -alto / 2 + r);
      placaForma.lineTo(ancho / 2, alto / 2 - r);
      placaForma.quadraticCurveTo(ancho / 2, alto / 2, ancho / 2 - r, alto / 2);
      placaForma.lineTo(-ancho / 2 + r, alto / 2);
      placaForma.quadraticCurveTo(-ancho / 2, alto / 2, -ancho / 2, alto / 2 - r);
      placaForma.lineTo(-ancho / 2, -alto / 2 + r);
      placaForma.quadraticCurveTo(-ancho / 2, -alto / 2, -ancho / 2 + r, -alto / 2);
      const placa = new THREE.Mesh(new THREE.ShapeGeometry(placaForma, 6),
        new THREE.MeshBasicMaterial({ color: '#f5efe2', transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
      placa.position.z = -0.04;
      placa.renderOrder = 39;

      this.logo = new THREE.Group();
      this.logo.add(placa, malla);
      this.logo.scale.setScalar(0.62);
      this.logoY = this.proporcion / 2 + 0.2;   // por encima del borde superior de la postal
      this.logo.position.set(0, this.logoY, 0.12);
      this.grupo.add(this.logo);
    },

    mostrar() {
      // Intro de nuevo si es la primera vez o si el poster estuvo fuera de vista un buen rato
      const ausencia = this.perdidoEn === null ? Infinity : (performance.now() - this.perdidoEn) / 1000;
      if (ausencia > T.reinicio) this.t = MOVIMIENTO_REDUCIDO ? T.finIntro + 1 : 0;
      this.activo = true;
      this.grupo.visible = true;
    },

    ocultar() {
      this.activo = false;
      this.perdidoEn = performance.now();
    },

    tick(_tiempo, delta) {
      if (!this.activo) return;
      this.t += Math.min(delta, 100) / 1000;   // evita saltos tras una pausa larga
      if (this.listo) this.actualizar(this.t);
    },

    actualizar(t) {
      const bucle = MOVIMIENTO_REDUCIDO ? 0 : 1;

      // Fondo
      this.base.material.opacity = suavizar(progreso(t, 0, T.base));

      // Capas que se despegan y suben
      for (const capa of this.capas) {
        const { datos, pieza, sombra, i } = capa;
        const p = progreso(t, datos.inicio, T.subida);
        const altura = datos.z * rebote(p);
        const respiro = bucle * Math.sin(t * 0.9 + i * 1.3) * 0.006 * suavizar(progreso(t, T.finIntro, 1));
        pieza.position.z = 0.003 + i * 0.0005 + altura + respiro;
        pieza.material.opacity = suavizar(progreso(t, 0, T.base));
        // Al subir, la pieza crece un poco y se inclina como una tarjeta que se levanta
        pieza.scale.setScalar(1 + 0.04 * Math.sin(Math.PI * p));
        pieza.rotation.x = -0.35 * (1 - suavizar(p)) * (p > 0 ? 1 : 0);

        // La sombra se aleja y se suaviza cuanto más alta está la pieza
        const elev = Math.max(altura, 0);
        sombra.position.x = datos.x + elev * 0.18;
        sombra.position.y = datos.y - elev * 0.25;
        sombra.material.opacity = 0.32 * suavizar(p);

        if (datos.nombre === 'flecha') {
          const vaiven = 0.5 - 0.5 * Math.cos((t - T.finIntro) * Math.PI * 2 / 1.6);
          pieza.position.x = datos.x + bucle * 0.012 * vaiven * (t > T.finIntro ? 1 : 0);
        }
        if (datos.nombre === 'rosas') {
          pieza.rotation.z = bucle * 0.015 * Math.sin(t * 1.4) * suavizar(progreso(t, T.finIntro, 1));
        }
      }

      this.actualizarPetalos(t, bucle);
      this.actualizarLogo(t, bucle);
    },

    actualizarPetalos(t, bucle) {
      const r = this.rosas;
      const aux = this.auxPetalo;
      const visibles = bucle && t > T.petalos;
      for (let i = 0; i < NUM_PETALOS; i++) {
        const periodo = 4.5 + azar(i, 1) * 3.5;
        const edad = t - T.petalos - azar(i, 2) * periodo;   // cada pétalo nace en su momento
        if (!visibles || edad < 0) {
          aux.scale.setScalar(0);
        } else {
          const u = (edad % periodo) / periodo;               // 0..1 a lo largo de su vuelo
          const x0 = r.x + (azar(i, 3) - 0.5) * r.ancho * 0.9;
          const y0 = r.y + (azar(i, 4) - 0.5) * r.alto * 0.8;
          // Sube, el viento lo lleva hacia la izquierda y arriba, y gira en espiral
          aux.position.set(
            x0 - u * (0.35 + azar(i, 5) * 0.3) + Math.sin(u * 6 + i) * 0.03,
            y0 + u * (0.25 + azar(i, 6) * 0.35) + Math.cos(u * 5 + i) * 0.02,
            r.z + 0.02 + u * (0.25 + azar(i, 7) * 0.2),
          );
          aux.rotation.set(t * (1 + azar(i, 8) * 2) + i, t * (0.7 + azar(i, 9)) + i * 2, u * 6);
          aux.scale.setScalar(Math.sin(Math.PI * u) * (0.7 + azar(i, 10) * 0.6));
        }
        aux.updateMatrix();
        this.petalos.setMatrixAt(i, aux.matrix);
      }
      this.petalos.instanceMatrix.needsUpdate = true;
    },

    actualizarLogo(t, bucle) {
      const p = progreso(t, T.logo, T.logoDuracion);
      const entrada = rebote(p);
      this.logo.visible = p > 0;
      this.logo.scale.setScalar(0.62 * Math.max(entrada, 0.0001));
      // Gira desde de lado (90°) hasta quedar de frente, y luego se balancea suave
      this.logo.rotation.y = (1 - suavizar(p)) * Math.PI / 2
        + bucle * 0.22 * Math.sin((t - T.logo) * 0.7) * suavizar(progreso(t, T.finIntro, 1.5));
      this.logo.position.y = this.logoY - 0.12 * (1 - suavizar(p))
        + bucle * 0.015 * Math.sin(t * 1.6);
    },

    remove() {
      this.el.removeObject3D('postal');
    },
  });
})();
