#!/usr/bin/env node
// Sondeo de estructura de un PDF usando PDF.js, el mismo motor que usa la
// herramienta (a diferencia de sondeo_estructura.py, que usa pypdf y NO ve
// lo mismo: fue asi como se detecto que un documento tabular real partia
// cada fila en dos lineas con PDF.js sin que el sondeo con pypdf lo avisara).
//
// Mismas normas que sondeo_estructura.py: enmascara TODO por clase de
// caracter salvo un vocabulario que se calcula por frecuencia, revisa la
// seccion 2 (vocabulario) antes de compartir la salida, usa --ocultar si se
// cuela algo.
//
// Uso:
//   node sondear_pdfjs.cjs archivo.pdf
//   node sondear_pdfjs.cjs archivo.pdf --paginas 16 --modo linea --umbral 0.5
//   node sondear_pdfjs.cjs archivo.pdf --ocultar PALABRA OTRAPALABRA
//
// Ejecuta esto en tu propia terminal, no dejes que nadie mas lo haga por ti.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const pdfPath = args.find(a => !a.startsWith('--'));
if (!pdfPath) {
  console.error('Uso: node sondear_pdfjs.cjs archivo.pdf [--paginas N] '
    + '[--modo pagina|linea] [--umbral 0.6] [--ocultar PALABRA ...]');
  process.exit(1);
}
function opcion(nombre, porDefecto) {
  const i = args.indexOf(`--${nombre}`);
  return i === -1 ? porDefecto : args[i + 1];
}
const numPaginas = Number(opcion('paginas', 12));
const modo = opcion('modo', 'pagina');
const umbral = Number(opcion('umbral', modo === 'linea' ? 0.5 : 0.6));
const iOcultar = args.indexOf('--ocultar');
const ocultar = new Set(
  (iOcultar === -1 ? [] : args.slice(iOcultar + 1)).map(w => w.toLowerCase()));

const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
const DIGIT_RE = /[0-9]/g;

function enmascararPalabra(w) {
  return [...w].map(c => c === c.toUpperCase() ? 'X' : 'x').join('');
}
function enmascarar(texto, plantilla) {
  texto = texto.replace(DIGIT_RE, '#');
  return texto.replace(WORD_RE, w =>
    plantilla.has(w.toLowerCase()) ? w : enmascararPalabra(w));
}

// Entorno minimo para cargar PDF.js UMD en Node, igual que en el resto de
// scripts de verificacion de este proyecto.
global.window = global;
global.navigator = { userAgent: 'node' };
global.document = {
  currentScript: null, createElement: () => ({ style: {} }),
  documentElement: { style: {} },
};
const raiz = __dirname;
eval(fs.readFileSync(path.join(raiz, 'vendor/pdf.min.js'), 'utf8'));
eval(fs.readFileSync(path.join(raiz, 'vendor/pdf.worker.min.js'), 'utf8'));

/** Agrupa fragmentos en lineas por Y, igual que agruparEnLineas de
 * src/parser.js (copia minima e independiente: este script es una
 * herramienta de diagnostico aparte, no importa codigo de produccion). */
function agruparEnLineas(items) {
  const u = items.filter(it => it && it.str && it.str.trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5],
                  altura: it.height || 10, texto: it.str.trim() }))
    .sort((a, b) => b.y - a.y);
  const grupos = [];
  let actual = null, anterior = null;
  for (const f of u) {
    const tol = anterior === null ? 0
      : Math.max(2, f.altura * 0.5, anterior.altura * 0.5);
    if (actual === null || Math.abs(anterior.y - f.y) > tol) {
      actual = { fragmentos: [] };
      grupos.push(actual);
    }
    actual.fragmentos.push(f);
    anterior = f;
  }
  return grupos.map(g => g.fragmentos.map(f => f.texto).join(' '));
}

(async () => {
  const datos = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data: datos }).promise;
  const total = doc.numPages;
  const n = Math.min(numPaginas, total);
  const idx = [...new Set([0, 1, ...Array.from({ length: n },
    (_, i) => Math.round(i * (total - 1) / Math.max(n - 1, 1)))])].slice(0, n);

  const paginasLineas = [];
  for (const i of idx) {
    const contenido = await (await doc.getPage(i + 1)).getTextContent();
    paginasLineas.push({ pagina: i + 1, lineas: agruparEnLineas(contenido.items) });
  }

  console.log('='.repeat(72));
  console.log('1. DIAGNOSTICO (via PDF.js, el motor que usa la herramienta)');
  console.log('='.repeat(72));
  console.log(`Paginas totales: ${total}`);
  console.log(`Paginas muestreadas: ${idx.map(i => i + 1).join(', ')}`);
  const conteoLineas = paginasLineas.map(p => p.lineas.length);
  console.log(`Lineas por pagina: min=${Math.min(...conteoLineas)} `
    + `max=${Math.max(...conteoLineas)}`);
  if (Math.max(...conteoLineas) > 25) {
    console.log('>>> AVISO: muchas lineas por pagina. Si es un listado con '
      + 'varias filas de datos por pagina, usa --modo linea.');
  }

  const todasLasLineas = paginasLineas.flatMap(p => p.lineas);
  const registros = modo === 'linea' ? todasLasLineas
    : paginasLineas.map(p => p.lineas.join(' '));
  const apariciones = new Map();
  for (const r of registros) {
    for (const w of new Set((r.match(WORD_RE) || []).map(x => x.toLowerCase()))) {
      apariciones.set(w, (apariciones.get(w) || 0) + 1);
    }
  }
  const minimo = Math.max(2, Math.floor(registros.length * umbral));
  const plantilla = new Set([...apariciones.entries()]
    .filter(([w, c]) => c >= minimo && !ocultar.has(w))
    .map(([w]) => w));

  console.log();
  console.log('='.repeat(72));
  console.log('2. VOCABULARIO CONSERVADO (palabras tratadas como plantilla)');
  console.log('='.repeat(72));
  console.log(`Modo: ${modo}. Criterio: aparece en >= ${minimo} de `
    + `${registros.length} ${modo === 'linea' ? 'lineas' : 'paginas'}.`);
  console.log('REVISA ESTA LISTA antes de compartir la salida.\n');
  console.log('  ' + ([...plantilla].sort().join('  ') || '(vacio)'));

  console.log();
  console.log('='.repeat(72));
  console.log('3. PAGINAS ENMASCARADAS (con PDF.js)');
  console.log('='.repeat(72));
  for (const { pagina, lineas } of paginasLineas.slice(0, 3)) {
    console.log(`\n----- pagina ${pagina} ` + '-'.repeat(50));
    for (const l of lineas) console.log(enmascarar(l, plantilla));
  }
})();
