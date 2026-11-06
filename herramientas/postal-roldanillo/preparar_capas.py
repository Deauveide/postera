"""
Prepara las capas de la postal "Roldanillo 2026" (Cartas del Alma) para la escena Three.js.

Como todavía no tenemos el archivo por capas, los elementos se recortan del JPG plano
usando color (tono) + un polígono aproximado por elemento. Cuando lleguen las capas
originales basta con sustituir los PNG de assets/poster-3/capas/ (mismos nombres).

Uso (desde la raíz del proyecto):
    python herramientas/postal-roldanillo/preparar_capas.py

Salida en assets/poster-3/:
    capas/base.jpg        Fondo "limpio": la postal sin los elementos que se elevan
    capas/<nombre>.png    Cada elemento recortado con transparencia
    capas.json            Posición de cada capa en unidades de MindAR (1 = ancho de la postal)
    logo.json             Contornos vectoriales del logotipo "Cartas del Alma"
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
ORIGINAL = RAIZ / 'assets/_originales/poster-3/postal-roldanillo.jpg'
LOGO = RAIZ / 'assets/_originales/poster-3/logo-cartas-del-alma.jpg'
SALIDA = RAIZ / 'assets/poster-3'
CAPAS = SALIDA / 'capas'
DEBUG = Path(__file__).resolve().parent / 'debug'

ESCALA = 2  # las texturas se generan al doble de la resolución del JPG (bordes más suaves)

img = np.array(Image.open(ORIGINAL).convert('RGB')).astype(np.int16)
H, W = img.shape[:2]
R, G, B = img[..., 0], img[..., 1], img[..., 2]
lum = (R + G + B) / 3
sat = img.max(axis=2) - img.min(axis=2)

# ---------- Clases de color ----------
negro = (lum < 120) & (sat < 45)
caqui = (np.abs(R - 214) < 22) & (np.abs(G - 208) < 22) & (np.abs(B - 148) < 30)
caqui_claro = (G > 215) & (B < 200) & (G >= R - 5)          # líneas verde claro de las baldosas
fondo_caqui = caqui | caqui_claro
piel = (R - B > 45) & (R - G > 15) & (R - G < 75) & (lum > 95) & (lum < 215)
rojo = (R - G > 80) & (R > 90)

# Zona del dibujo (dentro del marco rojo del sello)
ARTE = (41, 41, 494, 668)
dentro_arte = np.zeros((H, W), bool)
dentro_arte[ARTE[1]:ARTE[3], ARTE[0]:ARTE[2]] = True


def poligono(puntos):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(puntos, np.int32)], 1)
    return m.astype(bool)


def rellenar_huecos(m):
    """Rellena los huecos interiores de una máscara (contornos externos rellenos)."""
    m8 = m.astype(np.uint8)
    contornos, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = np.zeros_like(m8)
    cv2.drawContours(out, contornos, -1, 1, thickness=cv2.FILLED)
    return out.astype(bool)


def cerrar(m, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool)


def dilatar(m, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(m.astype(np.uint8), k).astype(bool)


def quitar_pequenos(m, minimo):
    n, etiquetas, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    out = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= minimo:
            out |= etiquetas == i
    return out


# ---------- Máscaras de los elementos (coordenadas del JPG, 535×738) ----------
# Rosas: rojo + sus contornos negros, esquina inferior derecha
zona_rosas = poligono([(300, 515), (494, 515), (494, 668), (300, 668)])
rosas = rojo & zona_rosas & dentro_arte
rosas = rellenar_huecos(cerrar(rosas | (negro & dilatar(rosas, 4) & zona_rosas), 3))
rosas = quitar_pequenos(rosas, 400)

# León (delante de la mujer). Polígono generoso; el color recorta el borde real.
zona_leon = poligono([
    (100, 575), (150, 470), (195, 395), (225, 352), (290, 338), (350, 350), (372, 372),
    (378, 395), (335, 410), (330, 460), (345, 520), (372, 545), (330, 668), (100, 668)])
cuerpo = (piel | negro) & dentro_arte & ~fondo_caqui
leon = rellenar_huecos(cerrar(cuerpo & zona_leon, 4)) & zona_leon & ~rosas
leon = quitar_pequenos(leon, 2000)

# Mujer (detrás del león), con la mano que sostiene la rosa
zona_mujer = poligono([
    (352, 330), (356, 280), (380, 248), (430, 236), (494, 238), (494, 530),
    (440, 540), (395, 560), (360, 545), (330, 500), (318, 455), (340, 420), (352, 390)])
mujer = rellenar_huecos(cerrar(cuerpo & zona_mujer, 4)) & zona_mujer & ~leon & ~rosas
mujer = quitar_pequenos(mujer, 2000)

# Letrero y flecha
LETRERO = (262, 226, 335, 322)
letrero = np.zeros((H, W), bool)
letrero[LETRERO[1]:LETRERO[3], LETRERO[0]:LETRERO[2]] = True
caja = rellenar_huecos(cerrar(negro & letrero, 2)) | (rellenar_huecos(negro & letrero))
letrero = rellenar_huecos(cerrar(letrero & (negro | (lum > 200)) & ~fondo_caqui, 2)) & letrero
FLECHA = (276, 236, 321, 257)
flecha = np.zeros((H, W), bool)
flecha[FLECHA[1]:FLECHA[3], FLECHA[0]:FLECHA[2]] = True
flecha &= lum > 150
flecha = dilatar(flecha, 1) & (lum > 110)

# Toldo (techo blanco con sus líneas)
zona_toldo = poligono([(98, 146), (226, 76), (318, 82), (320, 41), (494, 41), (494, 205),
                       (258, 212), (254, 268), (228, 258), (98, 174)])
rotulo = np.zeros((H, W), bool)
rotulo[37:83, 37:319] = True          # rótulo rojo "ROLDANILLO": se queda en el fondo
toldo = zona_toldo & ~fondo_caqui & dentro_arte & ~rotulo & ~rojo
toldo = rellenar_huecos(cerrar(toldo, 2)) & zona_toldo & ~rotulo
toldo = quitar_pequenos(toldo, 3000)

ELEMENTOS = {
    # nombre: (máscara, altura z final, orden de aparición en segundos)
    'toldo': (toldo, 0.05, 0.35),
    'letrero': (letrero, 0.09, 0.65),
    'mujer': (mujer, 0.13, 0.95),
    'leon': (leon, 0.19, 1.25),
    'rosas': (rosas, 0.26, 1.55),
}

# ---------- Texturas al doble de resolución ----------
W2, H2 = W * ESCALA, H * ESCALA
img2 = np.array(Image.open(ORIGINAL).convert('RGB').resize((W2, H2), Image.LANCZOS))


def mascara_suave(m):
    """Escala la máscara al doble con bordes antialias (alfa 0..255)."""
    m2 = cv2.resize(m.astype(np.float32), (W2, H2), interpolation=cv2.INTER_LINEAR)
    m2 = cv2.GaussianBlur(m2, (3, 3), 0)
    return np.clip(m2 * 255, 0, 255).astype(np.uint8)


def guardar_capa(nombre, m, rgb=None):
    """Guarda el recorte (solo su caja) y devuelve su rectángulo en px del JPG original."""
    ys, xs = np.where(m)
    x0, x1 = max(xs.min() - 2, 0), min(xs.max() + 3, W)
    y0, y1 = max(ys.min() - 2, 0), min(ys.max() + 3, H)
    alfa = mascara_suave(m)
    fuente = img2 if rgb is None else rgb
    rgba = np.dstack([fuente, alfa])[y0 * ESCALA:y1 * ESCALA, x0 * ESCALA:x1 * ESCALA]
    Image.fromarray(rgba, 'RGBA').save(CAPAS / f'{nombre}.png', optimize=True)
    return [int(x0), int(y0), int(x1), int(y1)]


def a_unidades(rect):
    """Rectángulo en px del JPG -> centro y tamaño en unidades de MindAR (ancho postal = 1)."""
    x0, y0, x1, y1 = rect
    return {
        'x': round(((x0 + x1) / 2 - W / 2) / W, 5),
        'y': round(-((y0 + y1) / 2 - H / 2) / W, 5),
        'ancho': round((x1 - x0) / W, 5),
        'alto': round((y1 - y0) / W, 5),
    }


CAPAS.mkdir(parents=True, exist_ok=True)
DEBUG.mkdir(exist_ok=True)

config = {'proporcion': H / W, 'capas': []}

# Letrero sin flecha (la flecha va en su propia capa y se mueve)
cajanegra = np.median(img2[(cv2.resize(flecha.astype(np.uint8), (W2, H2)) == 0)
                           & (cv2.resize((negro & letrero).astype(np.uint8), (W2, H2)) == 1)], axis=0)
letrero_rgb = img2.copy()
hueco = cv2.resize(dilatar(flecha, 1).astype(np.uint8), (W2, H2)).astype(bool)
letrero_rgb[hueco] = cajanegra.astype(np.uint8)

for nombre, (m, z, inicio) in ELEMENTOS.items():
    rect = guardar_capa(nombre, m, letrero_rgb if nombre == 'letrero' else None)
    config['capas'].append({'nombre': nombre, 'archivo': f'capas/{nombre}.png',
                            'z': z, 'inicio': inicio, **a_unidades(rect)})
    if nombre == 'letrero':
        rect_f = guardar_capa('flecha', flecha)
        config['capas'].append({'nombre': 'flecha', 'archivo': 'capas/flecha.png',
                                'z': z + 0.004, 'inicio': inicio, **a_unidades(rect_f)})

# ---------- Fondo limpio ----------
# Donde había un elemento elevado se rellena (inpainting) y se oscurece un poco:
# parece la silueta troquelada que dejó la pieza al despegarse del papel.
quitado = np.zeros((H, W), bool)
for m, _, _ in ELEMENTOS.values():
    quitado |= m
quitado2 = cv2.resize(dilatar(quitado, 2).astype(np.uint8), (W2, H2), interpolation=cv2.INTER_NEAREST).astype(bool)
# Relleno plano: caqui a la izquierda de la pared (x < 250 px del JPG), blanco de pared a la derecha.
# No se usa inpainting porque arrastra el rojo del marco hacia dentro.
relleno = np.zeros_like(img2)
relleno[:, :250 * ESCALA] = (214, 208, 148)
relleno[:, 250 * ESCALA:] = (246, 244, 238)
base = img2.astype(np.float32)
base[quitado2] = relleno[quitado2]
# Sombra solo junto al borde del troquel + un velo muy leve dentro
suave = cv2.GaussianBlur(quitado2.astype(np.float32), (0, 0), 6)
borde = np.clip(suave * (1 - suave) * 4, 0, 1)
base *= (1 - 0.06 * quitado2 - 0.22 * borde)[..., None]
Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(CAPAS / 'base.jpg', quality=90)

# Imagen de control: cada máscara coloreada sobre la postal
control = img.astype(np.float32).copy()
colores = {'toldo': (0, 120, 255), 'letrero': (255, 0, 255), 'mujer': (0, 200, 0),
           'leon': (255, 140, 0), 'rosas': (0, 255, 255)}
for nombre, (m, _, _) in ELEMENTOS.items():
    control[m] = control[m] * 0.45 + np.array(colores[nombre]) * 0.55
control[flecha] = (255, 255, 0)
Image.fromarray(control.astype(np.uint8)).resize((W2, H2)).save(DEBUG / 'mascaras.png')

(SALIDA / 'capas.json').write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding='utf-8')

# ---------- Logotipo "Cartas del Alma" -> contornos vectoriales ----------
logo = np.array(Image.open(LOGO).convert('RGB')).astype(np.int16)
FACTOR = 4
logo = cv2.resize(logo.astype(np.uint8), None, fx=FACTOR, fy=FACTOR, interpolation=cv2.INTER_CUBIC).astype(np.int16)
lr, lg, lb = logo[..., 0], logo[..., 1], logo[..., 2]
tinta = ((lr - lg > 70) & (lr - lb > 50)).astype(np.uint8)
tinta = cv2.morphologyEx(tinta, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
tinta = cv2.GaussianBlur(tinta * 255, (5, 5), 0)
_, tinta = cv2.threshold(tinta, 127, 255, cv2.THRESH_BINARY)
contornos, jerarquia = cv2.findContours(tinta, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
ys, xs = np.where(tinta > 0)
lx0, lx1, ly0, ly1 = xs.min(), xs.max(), ys.min(), ys.max()
ancho_logo = lx1 - lx0
cx, cy = (lx0 + lx1) / 2, (ly0 + ly1) / 2


def normalizar(c):
    c = cv2.approxPolyDP(c, 1.2, True)[:, 0, :].astype(float)
    # Unidades: el logotipo mide 1 de ancho, centrado, eje y hacia arriba
    return [[round((x - cx) / ancho_logo, 4), round(-(y - cy) / ancho_logo, 4)] for x, y in c]


formas = []
for i, c in enumerate(contornos):
    if jerarquia[0][i][3] != -1 or cv2.contourArea(c) < 150:
        continue  # solo contornos exteriores; los huecos se añaden abajo
    huecos = []
    hijo = jerarquia[0][i][2]
    while hijo != -1:
        if cv2.contourArea(contornos[hijo]) > 60:
            huecos.append(normalizar(contornos[hijo]))
        hijo = jerarquia[0][hijo][0]
    formas.append({'contorno': normalizar(c), 'huecos': huecos})

(SALIDA / 'logo.json').write_text(json.dumps({
    'proporcion': round((ly1 - ly0) / ancho_logo, 4),
    'color': '#b5121b',
    'formas': formas,
}, separators=(',', ':')), encoding='utf-8')

Image.fromarray(255 - tinta).save(DEBUG / 'logo.png')
print('capas:', [c['nombre'] for c in config['capas']], '| formas del logo:', len(formas))
