// Genera los íconos PNG de la PWA sin dependencias externas (solo módulos de Node).
// Uso: npm run iconos   →  docs/img/icons/icon-192.png, icon-512.png, icon-maskable-512.png
// Dibujo: cielo azul (theme_color), sol y dos montañas. Todo cae dentro de la "zona segura"
// central (80 %) para que el ícono maskable no se recorte en Android.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DESTINO = path.join(__dirname, '..', 'docs', 'img', 'icons');

const COLORES = {
  cielo: [0x1f, 0x38, 0x64],
  sol: [0xf2, 0xb1, 0x34],
  montanaAtras: [0x2e, 0xc4, 0xb6],
  montanaFrente: [0x4c, 0xaf, 0x50],
  suelo: [0x16, 0x29, 0x4a],
};

// ¿El punto (x, y) está dentro del triángulo a-b-c? Coordenadas normalizadas 0..1
function enTriangulo(x, y, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([x, y], a, b), d2 = s([x, y], b, c), d3 = s([x, y], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function colorEn(x, y) {
  if (y > 0.74) return COLORES.suelo;
  if (enTriangulo(x, y, [0.30, 0.74], [0.56, 0.36], [0.86, 0.74])) return COLORES.montanaFrente;
  if (enTriangulo(x, y, [0.12, 0.74], [0.38, 0.28], [0.62, 0.74])) return COLORES.montanaAtras;
  if ((x - 0.70) ** 2 + (y - 0.30) ** 2 < 0.085 ** 2) return COLORES.sol;
  return COLORES.cielo;
}

// Rasteriza con supermuestreo 4×4 para suavizar bordes
function pixeles(tam) {
  const datos = Buffer.alloc(tam * tam * 4);
  const M = 4;
  for (let py = 0; py < tam; py++) {
    for (let px = 0; px < tam; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < M; sy++) {
        for (let sx = 0; sx < M; sx++) {
          const c = colorEn((px + (sx + 0.5) / M) / tam, (py + (sy + 0.5) / M) / tam);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = (py * tam + px) * 4;
      datos[i] = r / (M * M); datos[i + 1] = g / (M * M); datos[i + 2] = b / (M * M); datos[i + 3] = 255;
    }
  }
  return datos;
}

// --- Codificación PNG mínima (RGBA de 8 bits) ---
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tipoYDatos));
  return Buffer.concat([largo, tipoYDatos, crc]);
}
function png(tam) {
  const rgba = pixeles(tam);
  const filas = Buffer.alloc(tam * (tam * 4 + 1));
  for (let y = 0; y < tam; y++) {
    filas[y * (tam * 4 + 1)] = 0; // filtro "None"
    rgba.copy(filas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', zlib.deflateSync(filas)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(DESTINO, { recursive: true });
for (const [nombre, tam] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
  fs.writeFileSync(path.join(DESTINO, nombre), png(tam));
  console.log('Generado', nombre, `${tam}×${tam}`);
}
