# Buscador de transferencias en PDF — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un único archivo `buscador.html` que se abre con doble clic,
convierte un PDF de más de 1500 páginas de transferencias en una tabla
filtrable por ordenante, importe, concepto y tres fechas, y la exporta a CSV.

**Architecture:** `src/parser.js` contiene la lógica de extracción como
funciones puras que no conocen ni PDF.js ni el DOM: reciben líneas de texto
con coordenadas y devuelven registros o anomalías. `src/ui.js` se encarga de
PDF.js, la interfaz y la exportación. `build.js` concatena PDF.js vendorizado
y ambos fuentes en el `buscador.html` entregable. Los tests atacan solo a
`parser.js`, con datos inventados, y corren en Node sin navegador.

**Tech Stack:** JavaScript sin framework ni bundler. PDF.js 3.11.174 (UMD).
`node --test` para los tests. Node solo para desarrollo; el entregable es
HTML estático.

**Spec:** `docs/superpowers/specs/2026-09-07-buscador-transferencias-pdf-design.md`

## Global Constraints

- **Sin dependencias npm.** Ni `package.json` con dependencias, ni
  `npm install`. Solo la librería estándar de Node y PDF.js vendorizado.
- **PDF.js versión exacta 3.11.174**, build UMD, desde
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/`. No actualizar:
  de la 4.0 en adelante solo hay ESM, que no funciona bajo `file://`.
- **`buscador.html` no hace ninguna petición de red.** Nunca un `<script
  src>` externo, ni `fetch`, ni fuentes de Google, ni imágenes remotas.
- **`src/parser.js` no puede referenciar `document`, `window`, `pdfjsLib`
  ni ninguna API de navegador.** Es la condición que lo hace testeable.
- **Ningún dato real en el repositorio.** Los fixtures se inventan. El
  `.gitignore` ya excluye `*.pdf` y `sondeo*.txt`; no tocarlo para añadir
  excepciones.
- **Importes solo en formato español** (`.` miles, `,` decimales) y fechas
  de campo solo en `dd-mm-aaaa`. Lo que no encaje es anomalía, nunca una
  interpretación alternativa.
- **Idioma:** interfaz, mensajes y nombres de función en español, sin
  acentos en los identificadores de código.
- Mensajes de commit en español, terminados en:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
  ```

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `vendor/pdf.min.js` | PDF.js UMD, descargado. No se versiona |
| `vendor/pdf.worker.min.js` | Worker de PDF.js, descargado. No se versiona |
| `src/parser.js` | Normalización, reconstrucción de líneas, extracción de campos, clasificación de anomalías. Funciones puras |
| `src/ui.js` | Carga del PDF, extracción por lotes, tabla, filtros, orden, columnas, CSV, errores |
| `src/estilos.css` | Estilos, embebidos por el build |
| `build.js` | Concatena vendor + estilos + fuentes en `buscador.html` |
| `test/fixtures/molde.js` | Constructores de páginas sintéticas con datos inventados |
| `test/parser.test.js` | Tests de `src/parser.js` |
| `buscador.html` | Entregable generado. Se versiona, para poder usarlo sin build |

---

### Task 0: Vendorizar PDF.js y despejar la incógnita de `file://`

Es un spike: su entrega es una decisión documentada, no código que se
conserve. El `spike.html` se borra al final.

**Files:**
- Create: `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` (descargados)
- Create (temporal): `spike.html`
- Modify: `docs/superpowers/specs/2026-09-07-buscador-transferencias-pdf-design.md`

**Interfaces:**
- Consumes: nada
- Produces: la estrategia de worker que usará la Task 5. Se anota en el spec
  sustituyendo la lista "se probarán en este orden" por la elegida.

- [ ] **Step 1: Descargar PDF.js**

```bash
mkdir -p vendor
curl -fSL -o vendor/pdf.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -fSL -o vendor/pdf.worker.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
ls -la vendor/
```

Esperado: `pdf.min.js` ~312 KB y `pdf.worker.min.js` ~1061 KB. Si algún
tamaño es de pocos cientos de bytes, se ha descargado una página de error:
parar y revisar.

- [ ] **Step 2: Escribir el spike de estrategia 1 (fake worker)**

Crear `spike.html`. Carga el worker como script normal, lo que define
`globalThis.pdfjsWorker`, y no fija `workerSrc`.

```html
<!doctype html>
<meta charset="utf-8">
<title>spike pdf.js file://</title>
<input type="file" id="f" accept="application/pdf">
<pre id="out">selecciona un PDF</pre>
<script src="vendor/pdf.min.js"></script>
<script src="vendor/pdf.worker.min.js"></script>
<script>
const out = document.getElementById('out');
const log = m => { out.textContent += '\n' + m; };
log('pdfjsLib: ' + (typeof pdfjsLib));
log('pdfjsWorker global: ' + (typeof globalThis.pdfjsWorker));

document.getElementById('f').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  out.textContent = 'procesando...';
  try {
    const t0 = performance.now();
    const datos = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: datos }).promise;
    log('paginas: ' + doc.numPages);
    const pagina = await doc.getPage(1);
    const contenido = await pagina.getTextContent();
    log('fragmentos en pagina 1: ' + contenido.items.length);
    log('primer item tiene transform: ' +
        Array.isArray(contenido.items[0].transform));
    log('ms totales: ' + Math.round(performance.now() - t0));
  } catch (err) {
    log('ERROR: ' + err.message);
  }
});
</script>
```

- [ ] **Step 3: Probar bajo `file://`**

```bash
open spike.html
```

Seleccionar el PDF de ejemplo del directorio. Esperado: se imprime el número
de páginas y un recuento de fragmentos mayor que cero, sin errores.

**Si funciona:** estrategia 1 fijada, saltar al Step 5.

**Si falla** con un error de worker, CORS u origen: pasar al Step 4.

- [ ] **Step 4: Probar estrategia 2 (Blob worker) solo si la 1 falló**

Sustituir en `spike.html` las dos etiquetas `<script src="vendor/...">` por
una sola de `pdf.min.js`, y añadir antes del resto del código:

```html
<script src="vendor/pdf.min.js"></script>
<script>
// Se lee el worker como texto ya embebido por el build; en el spike se
// simula pegando el contenido del fichero mediante un fetch local, que
// bajo file:// no funciona. Por eso aqui se prueba la via del Blob con un
// worker minimo, solo para comprobar que file:// permite Blob workers.
const w = new Worker(URL.createObjectURL(
  new Blob(['self.onmessage=()=>self.postMessage("vivo")'],
           { type: 'text/javascript' })));
w.onmessage = e => document.getElementById('out')
  .textContent += '\nBlob worker: ' + e.data;
w.onerror = e => document.getElementById('out')
  .textContent += '\nBlob worker ERROR: ' + e.message;
w.postMessage(1);
</script>
```

Volver a abrir con `open spike.html`. Si aparece `Blob worker: vivo`, la
estrategia 2 es viable y el build embeberá el worker como texto en un Blob.
Si tampoco, la salida es el servidor local y hay que **parar y consultar**,
porque cambia el requisito de doble clic.

- [ ] **Step 5: Anotar la decisión en el spec y limpiar**

En el spec, sustituir la lista numerada de tres estrategias por la elegida,
en una frase, indicando qué se observó. Después:

```bash
rm spike.html
```

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
Fijar la estrategia de worker de PDF.js bajo file://

vendor/ no se versiona: build.js lo descarga cuando falta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 1: Normalización de importes, fechas y texto

**Files:**
- Create: `src/parser.js`
- Create: `test/parser.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `normalizarImporte(texto: string) -> number | null`
  - `normalizarFecha(texto: string) -> string | null` (ISO `aaaa-mm-dd`)
  - `normalizarTexto(texto: string) -> string` (minúsculas sin diacríticos)

- [ ] **Step 1: Escribir los tests que fallan**

`test/parser.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarImporte, normalizarFecha, normalizarTexto,
} from '../src/parser.js';

test('normalizarImporte: formato espanol con y sin miles', () => {
  assert.equal(normalizarImporte('345,00'), 345);
  assert.equal(normalizarImporte('1.234,56'), 1234.56);
  assert.equal(normalizarImporte('1.234.567,89'), 1234567.89);
  assert.equal(normalizarImporte('0,05'), 0.05);
});

test('normalizarImporte: tolera espacios y codigo de moneda alrededor', () => {
  assert.equal(normalizarImporte('  1.234,56 EUR '), 1234.56);
});

test('normalizarImporte: rechaza lo que no es formato espanol', () => {
  assert.equal(normalizarImporte('1,234.56'), null); // formato ingles
  assert.equal(normalizarImporte('1 234,56'), null); // miles con espacio
  assert.equal(normalizarImporte('1234'), null);     // sin decimales
  assert.equal(normalizarImporte(''), null);
  assert.equal(normalizarImporte(null), null);
});

test('normalizarFecha: dd-mm-aaaa a ISO', () => {
  assert.equal(normalizarFecha('03-02-2025'), '2025-02-03');
  assert.equal(normalizarFecha('31-12-1999'), '1999-12-31');
});

test('normalizarFecha: rechaza otros separadores y fechas imposibles', () => {
  assert.equal(normalizarFecha('03/02/2025'), null);
  assert.equal(normalizarFecha('03.02.2025'), null);
  assert.equal(normalizarFecha('32-01-2025'), null);
  assert.equal(normalizarFecha('03-13-2025'), null);
  assert.equal(normalizarFecha(''), null);
});

test('normalizarTexto: minusculas y sin acentos', () => {
  assert.equal(normalizarTexto('OPERACIÓN'), 'operacion');
  assert.equal(normalizarTexto('Alojamiento Y Alimentación'),
                               'alojamiento y alimentacion');
  assert.equal(normalizarTexto('  espacios   colapsados '),
                               'espacios colapsados');
  assert.equal(normalizarTexto(null), '');
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `node --test test/`
Expected: FAIL, `Cannot find module '../src/parser.js'`

- [ ] **Step 3: Implementar**

`src/parser.js`:

```js
// Logica de extraccion. No conoce el DOM ni PDF.js: recibe lineas de texto
// con coordenadas y devuelve registros. Eso es lo que la hace testeable sin
// navegador y sin usar el PDF real.

const RE_IMPORTE = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d{1,3},\d{2}$/;
const RE_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/;

export function normalizarImporte(texto) {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(/\s|EUR|[A-Z]{3}$/g, '').trim();
  if (!RE_IMPORTE.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function normalizarFecha(texto) {
  if (typeof texto !== 'string') return null;
  const m = RE_FECHA.exec(texto.trim());
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const d = Number(dd), mes = Number(mm);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  // Rechaza dias que no existen en ese mes (30 de febrero, 31 de abril).
  const fecha = new Date(`${aaaa}-${mm}-${dd}T00:00:00Z`);
  if (fecha.getUTCDate() !== d || fecha.getUTCMonth() + 1 !== mes) return null;
  return `${aaaa}-${mm}-${dd}`;
}

export function normalizarTexto(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `node --test test/`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.js test/parser.test.js
git commit -m "$(cat <<'EOF'
Normalizacion de importes, fechas y texto de busqueda

Solo formato espanol y dd-mm-aaaa; lo demas devuelve null para que el
llamante lo trate como anomalia en vez de adivinar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 2: Reconstruir líneas a partir de los fragmentos de PDF.js

**Files:**
- Modify: `src/parser.js`
- Create: `test/fixtures/molde.js`
- Modify: `test/parser.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores
- Produces:
  - `agruparEnLineas(items: ItemPdf[]) -> Linea[]`
  - `ItemPdf` es la forma que da PDF.js: `{ str, transform, width, height }`,
    donde `transform[4]` es X y `transform[5]` es Y.
  - `Linea` es `{ y: number, fragmentos: Fragmento[], texto: string }`
  - `Fragmento` es `{ x: number, texto: string }`
  - Las líneas salen ordenadas de arriba abajo (Y descendente, porque el
    origen del PDF está abajo) y los fragmentos de izquierda a derecha.

- [ ] **Step 1: Escribir el constructor de fixtures**

`test/fixtures/molde.js`. Todos los datos son inventados.

```js
// Constructores de paginas sinteticas. Ningun dato real: los nombres,
// importes e IBAN de aqui son inventados.

/** Crea un item con la forma que devuelve PDF.js. */
export function item(x, y, texto, alturaFuente = 10) {
  return {
    str: texto,
    transform: [alturaFuente, 0, 0, alturaFuente, x, y],
    width: texto.length * alturaFuente * 0.5,
    height: alturaFuente,
  };
}

/** Crea una linea ya reconstruida, para tests que no pasan por agrupar. */
export function linea(y, ...paresXTexto) {
  const fragmentos = [];
  for (let i = 0; i < paresXTexto.length; i += 2) {
    fragmentos.push({ x: paresXTexto[i], texto: paresXTexto[i + 1] });
  }
  return {
    y,
    fragmentos,
    texto: fragmentos.map(f => f.texto).join(' '),
  };
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Añadir a `test/parser.test.js`:

```js
import { agruparEnLineas } from '../src/parser.js';
import { item } from './fixtures/molde.js';

test('agruparEnLineas: agrupa por Y y ordena por X', () => {
  const items = [
    item(120, 700, 'DERECHA'),
    item(10, 700, 'IZQUIERDA'),
    item(10, 680, 'SEGUNDA'),
  ];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas[0].fragmentos.map(f => f.texto),
                   ['IZQUIERDA', 'DERECHA']);
  assert.deepEqual(lineas[1].fragmentos.map(f => f.texto), ['SEGUNDA']);
});

test('agruparEnLineas: tolera micro-desviaciones de Y en la misma linea', () => {
  // PDF.js rara vez da Y identica para fragmentos de la misma linea.
  const items = [item(10, 700, 'A'), item(60, 700.4, 'B'), item(120, 699.6, 'C')];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].fragmentos.length, 3);
});

test('agruparEnLineas: ordena las lineas de arriba abajo', () => {
  const items = [item(10, 100, 'PIE'), item(10, 700, 'CABECERA')];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas[0].fragmentos[0].texto, 'CABECERA');
  assert.equal(lineas[1].fragmentos[0].texto, 'PIE');
});

test('agruparEnLineas: separa fragmentos con espacio al componer el texto', () => {
  const items = [item(10, 700, 'UNO'), item(60, 700, 'DOS')];
  assert.equal(agruparEnLineas(items)[0].texto, 'UNO DOS');
});

test('agruparEnLineas: descarta fragmentos vacios', () => {
  const items = [item(10, 700, 'A'), item(40, 700, '   '), item(60, 700, 'B')];
  assert.equal(agruparEnLineas(items)[0].fragmentos.length, 2);
});

test('agruparEnLineas: lista vacia da lista vacia', () => {
  assert.deepEqual(agruparEnLineas([]), []);
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `node --test test/`
Expected: FAIL, `agruparEnLineas is not a function`

- [ ] **Step 4: Implementar**

Añadir a `src/parser.js`:

```js
// Tolerancia vertical para decidir si dos fragmentos son la misma linea.
// PDF.js casi nunca da Y identica; media altura de fuente es el criterio
// habitual, con un minimo para fuentes muy pequenas.
function toleranciaY(alturaFuente) {
  return Math.max(2, alturaFuente * 0.5);
}

export function agruparEnLineas(items) {
  const utiles = (items || []).filter(it => it && it.str && it.str.trim());
  if (utiles.length === 0) return [];

  const grupos = [];
  for (const it of utiles) {
    const x = it.transform[4];
    const y = it.transform[5];
    const altura = it.height || Math.abs(it.transform[3]) || 10;
    const tol = toleranciaY(altura);
    let grupo = grupos.find(g => Math.abs(g.y - y) <= tol);
    if (!grupo) {
      grupo = { y, fragmentos: [] };
      grupos.push(grupo);
    }
    grupo.fragmentos.push({ x, texto: it.str.trim() });
  }

  grupos.sort((a, b) => b.y - a.y); // de arriba abajo
  for (const g of grupos) {
    g.fragmentos.sort((a, b) => a.x - b.x);
    g.texto = g.fragmentos.map(f => f.texto).join(' ');
  }
  return grupos;
}
```

- [ ] **Step 5: Verificar que pasan**

Run: `node --test test/`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src/parser.js test/
git commit -m "$(cat <<'EOF'
Reconstruir lineas de texto desde los fragmentos de PDF.js

Se conserva la X de cada fragmento: es lo que permitira separar la
columna del ordenante sin depender de posiciones fijas, que en el
sondeo se desplazaban entre paginas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 3: Extraer los seis campos del núcleo

**Files:**
- Modify: `src/parser.js`
- Modify: `test/fixtures/molde.js`
- Modify: `test/parser.test.js`

**Interfaces:**
- Consumes: `normalizarImporte`, `normalizarFecha`, `normalizarTexto` (Task 1);
  el tipo `Linea` (Task 2)
- Produces:
  - `MARCADOR = 'ORDEN DE TRANSFERENCIA'`
  - `parsearPagina(lineas: Linea[], numeroPagina: number) -> Resultado`
  - `Resultado` es `{ registro: Registro | null, anomalia: Anomalia | null }`
  - `Registro` según el spec: `pagina`, `ordenante`, `ordenanteBusqueda`,
    `importe`, `importeTexto`, `moneda`, `concepto`, `conceptoBusqueda`,
    `fechaOperacion`, `fechaOperacionTexto`, `fechaValor`,
    `fechaValorTexto`, `fechaEnvio`, `fechaEnvioTexto`, `extra` (objeto
    vacío hasta la Task 4)
  - `Anomalia` es `{ pagina, motivo, camposFaltantes: string[] }`

- [ ] **Step 1: Añadir el constructor de página completa a los fixtures**

Añadir a `test/fixtures/molde.js`:

Se añade al final del fichero, debajo de `item` y `linea`, que ya están
definidas ahí y se usan sin importar nada.

```js
// Coordenadas aproximadas tomadas del molde real, en unidades de PDF.
const X_IZQ = 20, X_CENTRO = 300, X_DER = 560;

/**
 * Pagina sintetica completa. Todos los valores por defecto son inventados.
 * `opciones.desplazamiento` desplaza las tres columnas, para reproducir el
 * corrimiento entre paginas que se observo en el sondeo.
 */
export function paginaMolde(opciones = {}) {
  const o = {
    ordenante: ['AYUNTAMIENTO DE VILLARRIBA'],
    importe: '345,00',
    beneficiario: 'EMPRESA EJEMPLO SL',
    concepto: ['ALOJAMIENTO Y ALIMENTACION'],
    fechaEnvio: '05-02-2025',
    fechaOperacion: '03-02-2025',
    fechaValor: '04-02-2025',
    conMarcador: true,
    desplazamiento: 0,
    conceptoPegado: false, // concepto en la misma linea que "CONCEPTO:"
    ...opciones,
  };
  const d = o.desplazamiento;
  const izq = X_IZQ + d, cen = X_CENTRO + d, der = X_DER + d;
  const L = [];
  let y = 760;

  L.push(linea(y, der, 'Oficina:'));
  y -= 14;
  L.push(linea(y, der, `Fecha de envío: ${o.fechaEnvio}`));
  y -= 14;
  if (o.conMarcador) {
    L.push(linea(y, izq, 'TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA'));
  } else {
    L.push(linea(y, izq, 'PAGINA DE OTRO TIPO'));
  }
  y -= 20;
  L.push(linea(y, izq, 'ORDENANTE', cen, 'IMPORTE', der, 'BENEFICIARIO'));
  y -= 18;

  // Linea del doble marcador: ordenante >> importe EUR >> beneficiario
  L.push(linea(y,
    izq, o.ordenante[0],
    cen - 40, '>>',
    cen, o.importe === null ? '' : `${o.importe}  EUR`,
    der - 40, '>>',
    der, o.beneficiario));
  y -= 12;

  // Lineas de continuacion del ordenante, en la columna izquierda
  for (const cont of o.ordenante.slice(1)) {
    L.push(linea(y, izq, cont));
    y -= 12;
  }

  L.push(linea(y, izq, 'POR CUENTA DE:',
                  cen, 'Importe origen: 345,00 EUR',
                  der, 'IBAN: ES00 1111 2222 3333 4444 5555'));
  y -= 12;
  L.push(linea(y, izq, 'Entidad: BANCO EJEMPLO, S.A.',
                  cen, 'Cambio aplicado origen: 1,000000',
                  der, 'Titular: EMPRESA EJEMPLO SL'));
  y -= 12;
  L.push(linea(y, cen, 'Importe recibido: 345,00 EUR'));
  y -= 12;
  L.push(linea(y, cen, 'Contravalor: 345,00 EUR'));
  y -= 18;

  if (o.conceptoPegado) {
    L.push(linea(y, izq, `CONCEPTO: ${o.concepto.join(' ')}`));
    y -= 12;
  } else {
    L.push(linea(y, izq, 'CONCEPTO:'));
    y -= 12;
    for (const c of o.concepto) {
      L.push(linea(y, izq, c));
      y -= 12;
    }
  }

  y = 60;
  L.push(linea(y, izq,
    `Refª Origen:   /   Nuestra Refª: 12345ABC678` +
    `Fecha operación: ${o.fechaOperacion} / Fecha valor: ${o.fechaValor}`));

  return L;
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Añadir a `test/parser.test.js`:

```js
import { parsearPagina } from '../src/parser.js';
import { paginaMolde } from './fixtures/molde.js';

test('parsearPagina: extrae los seis campos del nucleo', () => {
  const { registro, anomalia } = parsearPagina(paginaMolde(), 12);
  assert.equal(anomalia, null);
  assert.equal(registro.pagina, 12);
  assert.equal(registro.ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
  assert.equal(registro.importe, 345);
  assert.equal(registro.importeTexto, '345,00');
  assert.equal(registro.moneda, 'EUR');
  assert.equal(registro.concepto, 'ALOJAMIENTO Y ALIMENTACION');
  assert.equal(registro.fechaOperacion, '2025-02-03');
  assert.equal(registro.fechaValor, '2025-02-04');
  assert.equal(registro.fechaEnvio, '2025-02-05');
  assert.equal(registro.fechaOperacionTexto, '03-02-2025');
});

test('parsearPagina: ordenante de dos y tres lineas', () => {
  const dos = parsearPagina(paginaMolde({
    ordenante: ['AYUNTAMIENTO DE VILLARRIBA', 'DE LOS MONTES'],
  }), 1).registro;
  assert.equal(dos.ordenante, 'AYUNTAMIENTO DE VILLARRIBA DE LOS MONTES');

  const tres = parsearPagina(paginaMolde({
    ordenante: ['MANCOMUNIDAD DE MUNICIPIOS', 'DE LA COMARCA', 'DEL NORTE'],
  }), 1).registro;
  assert.equal(tres.ordenante,
    'MANCOMUNIDAD DE MUNICIPIOS DE LA COMARCA DEL NORTE');
});

test('parsearPagina: concepto de varias lineas se une con espacios', () => {
  const r = parsearPagina(paginaMolde({
    concepto: ['ALOJAMIENTO Y ALIMENTACION', 'DE ANIMALES', 'ENERO 2025'],
  }), 1).registro;
  assert.equal(r.concepto,
    'ALOJAMIENTO Y ALIMENTACION DE ANIMALES ENERO 2025');
});

test('parsearPagina: concepto en la misma linea que la etiqueta', () => {
  const r = parsearPagina(paginaMolde({
    conceptoPegado: true,
    concepto: ['REPARACION DE VALLADO PERIMETRAL'],
  }), 1).registro;
  assert.equal(r.concepto, 'REPARACION DE VALLADO PERIMETRAL');
});

test('parsearPagina: concepto de cuatro lineas', () => {
  const r = parsearPagina(paginaMolde({
    concepto: ['ALOJAMIENTO Y ALIMENTACION', 'DE ANIMALES', 'RECOGIDOS EN',
               'VIA PUBLICA'],
  }), 1).registro;
  assert.equal(r.concepto,
    'ALOJAMIENTO Y ALIMENTACION DE ANIMALES RECOGIDOS EN VIA PUBLICA');
});

test('parsearPagina: las fechas dentro del concepto no se confunden con campos', () => {
  const r = parsearPagina(paginaMolde({
    concepto: ['FACTURA FECHA 15.01.2025', 'PERIODO 01/01/2025 A 31/01/2025'],
    fechaOperacion: '03-02-2025',
  }), 1).registro;
  assert.equal(r.fechaOperacion, '2025-02-03');
  assert.ok(r.concepto.includes('15.01.2025'));
  assert.ok(r.concepto.includes('01/01/2025'));
});

test('parsearPagina: importe con separador de miles', () => {
  const r = parsearPagina(paginaMolde({ importe: '12.345,67' }), 1).registro;
  assert.equal(r.importe, 12345.67);
  assert.equal(r.importeTexto, '12.345,67');
});

test('parsearPagina: coge el importe del marcador, no los secundarios', () => {
  // El molde incluye "Importe origen: 345,00" y "Contravalor: 345,00".
  const r = parsearPagina(paginaMolde({ importe: '999,99' }), 1).registro;
  assert.equal(r.importe, 999.99);
});

test('parsearPagina: columnas desplazadas siguen parseando bien', () => {
  const r = parsearPagina(paginaMolde({
    desplazamiento: -8,
    ordenante: ['AYUNTAMIENTO DE VILLABAJO', 'DE LA SIERRA'],
  }), 1).registro;
  assert.equal(r.ordenante, 'AYUNTAMIENTO DE VILLABAJO DE LA SIERRA');
  assert.equal(r.importe, 345);
});

test('parsearPagina: campos de busqueda normalizados', () => {
  const r = parsearPagina(paginaMolde({
    ordenante: ['AYUNTAMIENTO DE ALCALÁ'],
    concepto: ['ALOJAMIENTO Y ALIMENTACIÓN'],
  }), 1).registro;
  assert.equal(r.ordenanteBusqueda, 'ayuntamiento de alcala');
  assert.equal(r.conceptoBusqueda, 'alojamiento y alimentacion');
});

test('parsearPagina: pagina sin marcador es anomalia y no da registro', () => {
  const { registro, anomalia } = parsearPagina(
    paginaMolde({ conMarcador: false }), 7);
  assert.equal(registro, null);
  assert.equal(anomalia.pagina, 7);
  assert.equal(anomalia.motivo, 'sin_marcador');
});

test('parsearPagina: pagina vacia es anomalia sin_texto', () => {
  const { registro, anomalia } = parsearPagina([], 3);
  assert.equal(registro, null);
  assert.equal(anomalia.motivo, 'sin_texto');
});

test('parsearPagina: falta un campo pero el registro se conserva', () => {
  // Requisito del spec: una anomalia de campo no puede ocultar la fila.
  const { registro, anomalia } = parsearPagina(
    paginaMolde({ importe: null }), 47);
  assert.notEqual(registro, null);
  assert.equal(registro.importe, null);
  assert.equal(registro.ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
  assert.equal(anomalia.motivo, 'campos_incompletos');
  assert.deepEqual(anomalia.camposFaltantes, ['importe']);
});

test('parsearPagina: importe en formato no espanol cuenta como faltante', () => {
  const { registro, anomalia } = parsearPagina(
    paginaMolde({ importe: '1 234,56' }), 5);
  assert.equal(registro.importe, null);
  assert.deepEqual(anomalia.camposFaltantes, ['importe']);
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `node --test test/`
Expected: FAIL, `parsearPagina is not a function`

- [ ] **Step 4: Implementar**

Añadir a `src/parser.js`:

```js
export const MARCADOR = 'ORDEN DE TRANSFERENCIA';

const CAMPOS_NUCLEO = ['ordenante', 'importe', 'concepto',
                       'fechaOperacion', 'fechaValor', 'fechaEnvio'];

/** Primera linea cuyo texto contiene la subcadena dada. */
function buscarLinea(lineas, subcadena) {
  return lineas.find(l => l.texto.includes(subcadena)) || null;
}

/**
 * Valor que sigue a una etiqueta. Busca dentro de cada FRAGMENTO, no en el
 * texto de la linea: las tres columnas comparten linea, asi que buscar en
 * la linea entera haria que "Entidad:" devolviese tambien el contenido de
 * las columnas de al lado. Un fragmento equivale a una celda.
 */
function valorTrasEtiqueta(lineas, etiqueta, patron) {
  for (const l of lineas) {
    for (const f of l.fragmentos) {
      const i = f.texto.indexOf(etiqueta);
      if (i === -1) continue;
      const m = patron.exec(f.texto.slice(i + etiqueta.length));
      if (m) return m[1];
    }
  }
  return null;
}

// dd-mm-aaaa inmediatamente despues de la etiqueta. Tolera espacios porque
// en el molde real "Nuestra Refª" viene pegada a "Fecha operación:".
const TRAS_FECHA = /^\s*(\d{2}-\d{2}-\d{4})/;
const MONEDA_FINAL = /\s([A-Z]{3})$/;

export function parsearPagina(lineas, numeroPagina) {
  if (!lineas || lineas.length === 0) {
    return {
      registro: null,
      anomalia: { pagina: numeroPagina, motivo: 'sin_texto', camposFaltantes: [] },
    };
  }
  if (!buscarLinea(lineas, MARCADOR)) {
    return {
      registro: null,
      anomalia: { pagina: numeroPagina, motivo: 'sin_marcador', camposFaltantes: [] },
    };
  }

  const reg = {
    pagina: numeroPagina,
    ordenante: null, ordenanteBusqueda: '',
    importe: null, importeTexto: null, moneda: null,
    concepto: null, conceptoBusqueda: '',
    fechaOperacion: null, fechaOperacionTexto: null,
    fechaValor: null, fechaValorTexto: null,
    fechaEnvio: null, fechaEnvioTexto: null,
    extra: {},
  };

  // --- Ancla 1: la linea con los dos ">>" ---
  const iMarca = lineas.findIndex(
    l => l.fragmentos.some(f => f.texto.includes('>>')));
  if (iMarca !== -1) {
    const lm = lineas[iMarca];
    const marcas = lm.fragmentos.filter(f => f.texto.includes('>>'));
    const xPrimera = marcas[0].x;
    const xSegunda = marcas.length > 1 ? marcas[1].x : Infinity;

    const izquierda = lm.fragmentos.filter(f => f.x < xPrimera);
    const centro = lm.fragmentos.filter(
      f => f.x > xPrimera && f.x < xSegunda && !f.texto.includes('>>'));
    const derecha = lm.fragmentos.filter(
      f => f.x > xSegunda && !f.texto.includes('>>'));

    const partesOrdenante = [izquierda.map(f => f.texto).join(' ').trim()];

    // Continuaciones: lineas siguientes con contenido a la izquierda del
    // primer ">>", hasta "POR CUENTA DE:" o "Entidad:".
    for (let i = iMarca + 1; i < lineas.length; i++) {
      const t = lineas[i].texto;
      if (t.includes('POR CUENTA DE:') || t.includes('Entidad:')) break;
      const izq = lineas[i].fragmentos.filter(f => f.x < xPrimera);
      const txt = izq.map(f => f.texto).join(' ').trim();
      if (txt) partesOrdenante.push(txt);
    }
    const ordenante = partesOrdenante.filter(Boolean).join(' ').trim();
    if (ordenante) reg.ordenante = ordenante;

    // El importe se valida ENTERO, no con un regex parcial: sobre
    // "1 234,56" un patron parcial capturaria "234,56" y daria por bueno
    // un importe equivocado en vez de marcarlo como anomalia.
    const textoCentro = centro.map(f => f.texto).join(' ').trim();
    const mMoneda = MONEDA_FINAL.exec(textoCentro);
    const soloImporte = mMoneda
      ? textoCentro.slice(0, mMoneda.index).trim()
      : textoCentro;
    const valor = normalizarImporte(soloImporte);
    if (valor !== null) {
      reg.importe = valor;
      reg.importeTexto = soloImporte;
      reg.moneda = mMoneda ? mMoneda[1] : null;
    }
    const beneficiario = derecha.map(f => f.texto).join(' ').trim();
    if (beneficiario) reg.extra.beneficiario = beneficiario;
  }

  // --- Ancla 2: CONCEPTO: hasta la linea de "Fecha operación:" ---
  const iConcepto = lineas.findIndex(l => l.texto.includes('CONCEPTO:'));
  if (iConcepto !== -1) {
    const partes = [];
    const mismaLinea = lineas[iConcepto].texto
      .split('CONCEPTO:')[1];
    if (mismaLinea && mismaLinea.trim()) partes.push(mismaLinea.trim());
    for (let i = iConcepto + 1; i < lineas.length; i++) {
      if (lineas[i].texto.includes('Fecha operación:')) break;
      const t = lineas[i].texto.trim();
      if (t) partes.push(t);
    }
    const concepto = partes.join(' ').replace(/\s+/g, ' ').trim();
    if (concepto) reg.concepto = concepto;
  }

  // --- Fechas, cada una anclada a su etiqueta ---
  const pares = [
    ['fechaOperacion', 'Fecha operación:'],
    ['fechaValor', 'Fecha valor:'],
    ['fechaEnvio', 'Fecha de envío:'],
  ];
  for (const [campo, etiqueta] of pares) {
    const bruto = valorTrasEtiqueta(lineas, etiqueta, TRAS_FECHA);
    const iso = normalizarFecha(bruto);
    if (iso) {
      reg[campo] = iso;
      reg[`${campo}Texto`] = bruto;
    }
  }

  reg.ordenanteBusqueda = normalizarTexto(reg.ordenante);
  reg.conceptoBusqueda = normalizarTexto(reg.concepto);

  const faltantes = CAMPOS_NUCLEO.filter(c => reg[c] === null);
  const anomalia = faltantes.length === 0 ? null : {
    pagina: numeroPagina,
    motivo: 'campos_incompletos',
    camposFaltantes: faltantes,
  };

  return { registro: reg, anomalia };
}
```

- [ ] **Step 5: Verificar que pasan**

Run: `node --test test/`
Expected: PASS, 26 tests.

- [ ] **Step 6: Commit**

```bash
git add src/parser.js test/
git commit -m "$(cat <<'EOF'
Extraer los seis campos del nucleo de cada transferencia

Anclado a las etiquetas y al doble ">>", nunca a posiciones fijas. Un
campo que falla no descarta el registro: entra en la tabla con ese
campo vacio y ademas se lista como anomalia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 4: Campos secundarios en `extra`

**Files:**
- Modify: `src/parser.js`
- Modify: `test/parser.test.js`

**Interfaces:**
- Consumes: `parsearPagina` (Task 3)
- Produces: `registro.extra` poblado con las claves `beneficiario`, `iban`,
  `titular`, `entidad`, `oficina`, `porCuentaDe`, `importeOrigen`,
  `importeRecibido`, `contravalor`, `nuestraRef`. Valores `string`, o
  ausentes si la etiqueta no aparece. Los importes secundarios se guardan
  como número mediante `normalizarImporte`, o `null`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/parser.test.js`:

```js
test('parsearPagina: rellena los campos secundarios en extra', () => {
  const r = parsearPagina(paginaMolde(), 1).registro;
  assert.equal(r.extra.beneficiario, 'EMPRESA EJEMPLO SL');
  assert.equal(r.extra.iban, 'ES00 1111 2222 3333 4444 5555');
  assert.equal(r.extra.titular, 'EMPRESA EJEMPLO SL');
  assert.equal(r.extra.entidad, 'BANCO EJEMPLO, S.A.');
  assert.equal(r.extra.importeOrigen, 345);
  assert.equal(r.extra.contravalor, 345);
});

test('parsearPagina: extra ausente no rompe el nucleo', () => {
  const lineas = paginaMolde().filter(l => !l.texto.includes('IBAN:'));
  const { registro, anomalia } = parsearPagina(lineas, 1);
  assert.equal(anomalia, null);
  assert.equal(registro.extra.iban, undefined);
  assert.equal(registro.importe, 345);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `node --test test/`
Expected: FAIL, `r.extra.iban` es `undefined`

- [ ] **Step 3: Implementar**

En `src/parser.js`, añadir antes del `return` de `parsearPagina`:

```js
  // --- Campos secundarios. No se muestran por defecto, pero extraerlos
  // ahora cuesta cero y evita reprocesar 1500 paginas si algun dia hacen
  // falta. ---
  const ETIQUETAS_EXTRA = [
    ['iban', 'IBAN:', /^\s*([A-Z]{2}[\d\s]{10,})/],
    ['titular', 'Titular:', /^\s*(.+?)\s*$/],
    ['entidad', 'Entidad:', /^\s*(.+?)\s*$/],
    ['oficina', 'Oficina:', /^\s*(.+?)\s*$/],
    ['porCuentaDe', 'POR CUENTA DE:', /^\s*(.+?)\s*$/],
    ['nuestraRef', 'Nuestra Refª:', /^\s*(.+?)(?=Fecha operación:|$)/],
  ];
  for (const [clave, etiqueta, patron] of ETIQUETAS_EXTRA) {
    const v = valorTrasEtiqueta(lineas, etiqueta, patron);
    if (v && v.trim()) reg.extra[clave] = v.trim();
  }

  const IMPORTES_EXTRA = [
    ['importeOrigen', 'Importe origen:'],
    ['importeRecibido', 'Importe recibido:'],
    ['contravalor', 'Contravalor:'],
  ];
  for (const [clave, etiqueta] of IMPORTES_EXTRA) {
    const v = valorTrasEtiqueta(lineas, etiqueta, /^\s*([\d.]*\d,\d{2})/);
    if (v) reg.extra[clave] = normalizarImporte(v);
  }
```

- [ ] **Step 4: Verificar que pasan**

Run: `node --test test/`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parser.js test/parser.test.js
git commit -m "$(cat <<'EOF'
Extraer tambien los campos secundarios en registro.extra

Ocultos por defecto en la tabla, pero disponibles sin reprocesar el
PDF si algun dia hacen falta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 5: Build y esqueleto de la interfaz

Entrega: un `buscador.html` que se abre con doble clic, acepta un PDF y
muestra cuántas páginas tiene. Sin tabla todavía.

**Files:**
- Create: `build.js`, `src/ui.js`, `src/estilos.css`
- Create (generado): `buscador.html`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: la estrategia de worker decidida en la Task 0
- Produces: `node build.js` genera `buscador.html`. `src/ui.js` define
  `const APP = { registros: [], anomalias: [], nombreArchivo: '' }` como
  estado del módulo, ampliado en tareas posteriores con `criterios`,
  `orden` y `filas`.

- [ ] **Step 1: Escribir `build.js`**

```js
// Concatena PDF.js vendorizado, estilos y fuentes en un unico
// buscador.html autocontenido. Sin bundler: los fuentes usan `export`
// para poder testearse con node --test, y aqui se elimina esa palabra
// para que valgan como script clasico.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const VENDOR = ['vendor/pdf.min.js', 'vendor/pdf.worker.min.js'];
for (const f of VENDOR) {
  if (!existsSync(f)) {
    console.error(`Falta ${f}. Descargalo con:
  curl -fSL -o ${f} https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/${f.split('/')[1]}`);
    process.exit(1);
  }
}

const leer = f => readFileSync(f, 'utf8');
const sinExport = f => leer(f).replace(/^export /gm, '');

const html = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Buscador de transferencias</title>
<style>
${leer('src/estilos.css')}
</style>
<body>
<div id="app"></div>
<script>${leer('vendor/pdf.min.js')}</script>
<script>${leer('vendor/pdf.worker.min.js')}</script>
<script>${sinExport('src/parser.js')}</script>
<script>${sinExport('src/ui.js')}</script>
</body>
</html>
`;

writeFileSync('buscador.html', html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`buscador.html generado (${kb} KB)`);
```

Si la Task 0 fijó la estrategia 2 (Blob worker), sustituir la segunda
etiqueta `<script>` por la inyección del worker como texto:

```js
const worker = JSON.stringify(leer('vendor/pdf.worker.min.js'));
// ...y en el html, en lugar del segundo <script>:
// <script>pdfjsLib.GlobalWorkerOptions.workerSrc =
//   URL.createObjectURL(new Blob([${worker}], {type:'text/javascript'}));</script>
```

- [ ] **Step 2: Escribir `src/estilos.css`**

```css
:root {
  --fondo: #fbfbfa; --texto: #1a1a18; --borde: #d9d7d2;
  --acento: #7c5c3e; --tenue: #6b6a66; --aviso: #8a5a00;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--fondo); color: var(--texto);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#app { max-width: 1400px; margin: 0 auto; padding: 24px 20px 60px; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.sub { color: var(--tenue); margin: 0 0 24px; }
.zona {
  border: 2px dashed var(--borde); border-radius: 10px;
  padding: 40px 20px; text-align: center; cursor: pointer;
}
.zona.encima { border-color: var(--acento); background: #f5efe8; }
.barra { height: 6px; background: var(--borde); border-radius: 3px; overflow: hidden; }
.barra > i { display: block; height: 100%; background: var(--acento); width: 0; }
.oculto { display: none; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--borde); }
th { cursor: pointer; user-select: none; white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.aviso { color: var(--aviso); }
```

- [ ] **Step 3: Escribir `src/ui.js` mínimo**

```js
// Interfaz: carga del PDF, extraccion por lotes, tabla y exportacion.
// Todo el trabajo ocurre en local; este fichero no hace ninguna peticion
// de red, y el build garantiza que no haya ningun src externo.

const APP = { registros: [], anomalias: [], nombreArchivo: '' };

function el(tag, props = {}, hijos = []) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const h of [].concat(hijos)) {
    n.append(h instanceof Node ? h : document.createTextNode(h));
  }
  return n;
}

function pintarInicio() {
  const app = document.getElementById('app');
  app.textContent = '';
  app.append(
    el('h1', { textContent: 'Buscador de transferencias' }),
    el('p', {
      className: 'sub',
      textContent: 'El PDF se procesa en tu equipo. No se envía a ningún sitio.',
    }),
  );

  const entrada = el('input', { type: 'file', accept: 'application/pdf',
                                className: 'oculto' });
  const zona = el('div', { className: 'zona',
    textContent: 'Arrastra el PDF aquí, o haz clic para elegirlo' });
  const estado = el('p', { className: 'sub' });
  const barra = el('div', { className: 'barra oculto' }, [el('i')]);

  zona.addEventListener('click', () => entrada.click());
  zona.addEventListener('dragover', e => {
    e.preventDefault(); zona.classList.add('encima');
  });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.classList.remove('encima');
    if (e.dataTransfer.files[0]) procesar(e.dataTransfer.files[0], estado, barra);
  });
  entrada.addEventListener('change', e => {
    if (e.target.files[0]) procesar(e.target.files[0], estado, barra);
  });

  app.append(zona, entrada, barra, estado);
}

async function procesar(archivo, estado, barra) {
  APP.nombreArchivo = archivo.name;
  estado.textContent = 'Abriendo el PDF...';
  barra.classList.remove('oculto');
  try {
    const datos = new Uint8Array(await archivo.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: datos }).promise;
    estado.textContent = `${doc.numPages} páginas. Extrayendo...`;
    barra.firstChild.style.width = '100%';
  } catch (err) {
    estado.textContent = 'No se pudo abrir: ' + err.message;
    estado.className = 'sub aviso';
  }
}

document.addEventListener('DOMContentLoaded', pintarInicio);
```

- [ ] **Step 4: Construir y probar bajo `file://`**

```bash
node build.js
open buscador.html
```

Esperado: la consola dice `buscador.html generado (~1400 KB)`. Al soltar el
PDF de ejemplo aparece "3 páginas. Extrayendo...". Si aparece un error de
worker, revisar la decisión de la Task 0.

- [ ] **Step 5: Ignorar `vendor/` y commitear**

Comprobar que `.gitignore` ya contiene `vendor/` (lo tiene). Confirmar que
el PDF sigue fuera del índice:

```bash
git status --porcelain --ignored | grep '^!!'
git add build.js src/ buscador.html
git commit -m "$(cat <<'EOF'
Build a fichero unico y esqueleto de la interfaz

buscador.html se genera concatenando PDF.js vendorizado y los fuentes.
Se versiona el entregable para poder usarlo sin ejecutar el build.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 6: Extracción por lotes con progreso y panel de anomalías

Entrega: al soltar el PDF se procesan todas las páginas mostrando progreso,
y al terminar aparece el recuento de transferencias y el panel de anomalías.

**Files:**
- Modify: `src/ui.js`

**Interfaces:**
- Consumes: `agruparEnLineas`, `parsearPagina` (Tasks 2 y 3)
- Produces:
  - `extraerTodo(doc, alProgresar) -> Promise<{registros, anomalias}>`
  - `alProgresar(hechas: number, total: number)` se llama una vez por lote
  - Rellena `APP.registros` y `APP.anomalias`

- [ ] **Step 1: Implementar la extracción por lotes**

Añadir a `src/ui.js`:

```js
const TAM_LOTE = 25; // paginas por lote antes de ceder el hilo

/** Cede el control al navegador para que repinte entre lotes. */
const respirar = () => new Promise(r => setTimeout(r, 0));

async function extraerTodo(doc, alProgresar) {
  const registros = [], anomalias = [];
  for (let inicio = 1; inicio <= doc.numPages; inicio += TAM_LOTE) {
    const fin = Math.min(inicio + TAM_LOTE - 1, doc.numPages);
    for (let n = inicio; n <= fin; n++) {
      try {
        const pagina = await doc.getPage(n);
        const contenido = await pagina.getTextContent();
        const lineas = agruparEnLineas(contenido.items);
        const { registro, anomalia } = parsearPagina(lineas, n);
        if (registro) registros.push(registro);
        if (anomalia) anomalias.push(anomalia);
      } catch (err) {
        anomalias.push({ pagina: n, motivo: 'error_parser',
                         camposFaltantes: [], detalle: err.message });
      }
    }
    alProgresar(fin, doc.numPages);
    await respirar();
  }
  return { registros, anomalias };
}
```

- [ ] **Step 2: Conectar el progreso**

Sustituir el cuerpo del `try` de `procesar` por:

```js
    const datos = new Uint8Array(await archivo.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: datos }).promise;
    const t0 = performance.now();
    const { registros, anomalias } = await extraerTodo(doc, (hechas, total) => {
      estado.textContent = `Página ${hechas} de ${total}`;
      barra.firstChild.style.width = (hechas / total * 100) + '%';
    });
    APP.registros = registros;
    APP.anomalias = anomalias;
    const seg = ((performance.now() - t0) / 1000).toFixed(1);
    barra.classList.add('oculto');
    pintarResultados(seg);
```

- [ ] **Step 3: Pintar recuento y panel de anomalías**

Añadir a `src/ui.js`:

```js
function pintarResultados(segundos) {
  const app = document.getElementById('app');
  app.textContent = '';
  app.append(
    el('h1', { textContent: 'Buscador de transferencias' }),
    el('p', { className: 'sub',
      textContent: `${APP.registros.length} transferencias de `
        + `${APP.nombreArchivo}, procesadas en ${segundos} s` }),
    panelAnomalias(),
  );
}

function panelAnomalias() {
  const cont = el('div');
  if (APP.anomalias.length === 0) {
    cont.append(el('p', { className: 'sub',
      textContent: 'Todas las páginas encajaron en el molde.' }));
    return cont;
  }
  const porMotivo = {};
  for (const a of APP.anomalias) {
    porMotivo[a.motivo] = (porMotivo[a.motivo] || 0) + 1;
  }
  const resumen = Object.entries(porMotivo)
    .map(([m, c]) => `${c} ${m}`).join(', ');

  const det = el('details');
  det.append(el('summary', { className: 'aviso',
    textContent: `${APP.anomalias.length} páginas no encajaron `
      + `en el molde (${resumen})` }));
  const lista = el('ul');
  for (const a of APP.anomalias.slice(0, 200)) {
    const campos = a.camposFaltantes.length
      ? ` — falta: ${a.camposFaltantes.join(', ')}` : '';
    lista.append(el('li', { textContent: `Página ${a.pagina}: ${a.motivo}${campos}` }));
  }
  if (APP.anomalias.length > 200) {
    lista.append(el('li', { className: 'sub',
      textContent: `…y ${APP.anomalias.length - 200} más` }));
  }
  det.append(lista);
  cont.append(det);
  return cont;
}
```

El panel lista número de página, motivo y nombre de campo. **Nunca
contenido de la página**: es el canal para depurar el molde sin exponer
datos.

- [ ] **Step 4: Construir y probar**

```bash
node build.js && open buscador.html
```

Soltar el PDF de ejemplo. Esperado: "3 transferencias de …, procesadas en
0.X s" y "Todas las páginas encajaron en el molde."

- [ ] **Step 5: Commit**

```bash
node build.js
git add src/ui.js buscador.html
git commit -m "$(cat <<'EOF'
Extraccion por lotes con progreso y panel de anomalias

Lotes de 25 paginas cediendo el hilo entre ellos, para que la barra
avance y la interfaz responda con 1500 paginas. El panel de anomalias
muestra solo numeros de pagina y nombres de campo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 7: Tabla, filtros y ordenación

**Files:**
- Modify: `src/ui.js`

**Interfaces:**
- Consumes: `APP.registros` (Task 6)
- Produces:
  - `COLUMNAS`: array de `{ clave, titulo, tipo, visible }` con
    `tipo ∈ {'num','texto','fecha','importe'}`
  - `filtrar(registros, criterios) -> Registro[]`
  - `criterios` es `{ ordenante, concepto, importeMin, importeMax,
    fechaOperacionDesde, fechaOperacionHasta, fechaValorDesde,
    fechaValorHasta, fechaEnvioDesde, fechaEnvioHasta }`
  - `APP.orden` es `{ clave, ascendente }`

- [ ] **Step 1: Definir columnas y filtrado**

Añadir a `src/ui.js`:

```js
const COLUMNAS = [
  { clave: 'pagina', titulo: 'Pág.', tipo: 'num', visible: true },
  { clave: 'ordenante', titulo: 'Ordenante', tipo: 'texto', visible: true },
  { clave: 'importe', titulo: 'Importe', tipo: 'importe', visible: true },
  { clave: 'concepto', titulo: 'Concepto', tipo: 'texto', visible: true },
  { clave: 'fechaOperacion', titulo: 'F. operación', tipo: 'fecha', visible: true },
  { clave: 'fechaValor', titulo: 'F. valor', tipo: 'fecha', visible: true },
  { clave: 'fechaEnvio', titulo: 'F. envío', tipo: 'fecha', visible: true },
];

APP.criterios = {};
APP.orden = { clave: 'pagina', ascendente: true };

function entreFechas(valor, desde, hasta) {
  if (desde && (!valor || valor < desde)) return false;
  if (hasta && (!valor || valor > hasta)) return false;
  return true;
}

function filtrar(registros, c) {
  const ordenante = normalizarTexto(c.ordenante || '');
  const concepto = normalizarTexto(c.concepto || '');
  const min = c.importeMin === '' || c.importeMin == null
    ? null : Number(c.importeMin);
  const max = c.importeMax === '' || c.importeMax == null
    ? null : Number(c.importeMax);

  return registros.filter(r => {
    if (ordenante && !r.ordenanteBusqueda.includes(ordenante)) return false;
    if (concepto && !r.conceptoBusqueda.includes(concepto)) return false;
    if (min !== null && (r.importe === null || r.importe < min)) return false;
    if (max !== null && (r.importe === null || r.importe > max)) return false;
    if (!entreFechas(r.fechaOperacion, c.fechaOperacionDesde, c.fechaOperacionHasta))
      return false;
    if (!entreFechas(r.fechaValor, c.fechaValorDesde, c.fechaValorHasta))
      return false;
    if (!entreFechas(r.fechaEnvio, c.fechaEnvioDesde, c.fechaEnvioHasta))
      return false;
    return true;
  });
}

function ordenar(registros, { clave, ascendente }) {
  const signo = ascendente ? 1 : -1;
  return [...registros].sort((a, b) => {
    const va = a[clave], vb = b[clave];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // los vacios siempre al final
    if (vb === null) return -1;
    if (va < vb) return -signo;
    if (va > vb) return signo;
    return 0;
  });
}
```

- [ ] **Step 2: Pintar los filtros**

```js
function campo(etiqueta, props, alCambiar) {
  const input = el('input', props);
  input.addEventListener('input', () => alCambiar(input.value));
  return el('label', {}, [etiqueta, input]);
}

function pintarFiltros(alFiltrar) {
  const c = APP.criterios;
  const set = (k) => (v) => { c[k] = v; alFiltrar(); };
  const caja = el('div', { className: 'filtros' }, [
    campo('Ordenante ', { type: 'search', placeholder: 'contiene…' },
          set('ordenante')),
    campo('Concepto ', { type: 'search', placeholder: 'contiene…' },
          set('concepto')),
    campo('Importe desde ', { type: 'number', step: '0.01' }, set('importeMin')),
    campo('hasta ', { type: 'number', step: '0.01' }, set('importeMax')),
    campo('F. operación desde ', { type: 'date' }, set('fechaOperacionDesde')),
    campo('hasta ', { type: 'date' }, set('fechaOperacionHasta')),
    campo('F. valor desde ', { type: 'date' }, set('fechaValorDesde')),
    campo('hasta ', { type: 'date' }, set('fechaValorHasta')),
    campo('F. envío desde ', { type: 'date' }, set('fechaEnvioDesde')),
    campo('hasta ', { type: 'date' }, set('fechaEnvioHasta')),
  ]);
  const limpiar = el('button', { textContent: 'Limpiar filtros' });
  limpiar.addEventListener('click', () => {
    APP.criterios = {};
    caja.querySelectorAll('input').forEach(i => { i.value = ''; });
    alFiltrar();
  });
  caja.append(limpiar);
  return caja;
}
```

- [ ] **Step 3: Pintar la tabla**

```js
function celda(r, col) {
  if (col.clave === 'importe') {
    return el('td', { className: 'num',
                      textContent: r.importeTexto || '—' });
  }
  if (col.tipo === 'fecha') {
    return el('td', { textContent: r[col.clave + 'Texto'] || '—' });
  }
  if (col.tipo === 'num') {
    return el('td', { className: 'num', textContent: String(r[col.clave]) });
  }
  return el('td', { textContent: r[col.clave] || '—' });
}

function pintarTabla(filas) {
  const visibles = COLUMNAS.filter(c => c.visible);
  const thead = el('thead');
  const tr = el('tr');
  for (const col of visibles) {
    const flecha = APP.orden.clave === col.clave
      ? (APP.orden.ascendente ? ' ▲' : ' ▼') : '';
    const th = el('th', { textContent: col.titulo + flecha });
    th.addEventListener('click', () => {
      if (APP.orden.clave === col.clave) {
        APP.orden.ascendente = !APP.orden.ascendente;
      } else {
        APP.orden = { clave: col.clave, ascendente: true };
      }
      refrescar();
    });
    tr.append(th);
  }
  thead.append(tr);

  const tbody = el('tbody');
  for (const r of filas) {
    tbody.append(el('tr', {}, visibles.map(col => celda(r, col))));
  }
  return el('table', {}, [thead, tbody]);
}
```

- [ ] **Step 4: Enlazar todo con `refrescar`**

Sustituir `pintarResultados` por:

```js
function refrescar() {
  const filas = ordenar(filtrar(APP.registros, APP.criterios), APP.orden);
  APP.filas = filas;
  document.getElementById('contador').textContent =
    `${filas.length} de ${APP.registros.length} transferencias`;
  const cont = document.getElementById('tabla');
  cont.textContent = '';
  cont.append(pintarTabla(filas));
}

function pintarResultados(segundos) {
  const app = document.getElementById('app');
  app.textContent = '';
  app.append(
    el('h1', { textContent: 'Buscador de transferencias' }),
    el('p', { className: 'sub',
      textContent: `${APP.registros.length} transferencias de `
        + `${APP.nombreArchivo}, procesadas en ${segundos} s` }),
    panelAnomalias(),
    pintarFiltros(refrescar),
    el('p', { id: 'contador', className: 'sub' }),
    el('div', { id: 'tabla' }),
  );
  refrescar();
}
```

- [ ] **Step 5: Añadir estilos de los filtros**

Añadir a `src/estilos.css`:

```css
.filtros {
  display: flex; flex-wrap: wrap; gap: 12px 18px;
  padding: 16px; margin: 16px 0;
  border: 1px solid var(--borde); border-radius: 8px; background: #fff;
}
.filtros label { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.filtros input {
  border: 1px solid var(--borde); border-radius: 5px; padding: 4px 7px;
  font: inherit; font-size: 13px;
}
.filtros input[type=search] { width: 180px; }
.filtros input[type=number] { width: 100px; }
.filtros button {
  border: 1px solid var(--borde); border-radius: 5px; background: #fff;
  padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer;
}
```

- [ ] **Step 6: Construir y probar**

```bash
node build.js && open buscador.html
```

Comprobar con el PDF de ejemplo: escribir parte de un ordenante reduce las
filas; un rango de importes que excluya todo deja "0 de 3"; el botón limpiar
las devuelve; hacer clic en "Importe" ordena y el segundo clic invierte.

- [ ] **Step 7: Commit**

```bash
node build.js
git add src/ buscador.html
git commit -m "$(cat <<'EOF'
Tabla con filtros combinables y ordenacion por columna

Ordenante y concepto por subcadena sin acentos ni mayusculas; importe y
las tres fechas por rango. Los valores vacios se ordenan al final.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 8: Selector de columnas y exportación a CSV

**Files:**
- Modify: `src/ui.js`, `src/estilos.css`

**Interfaces:**
- Consumes: `COLUMNAS`, `APP.filas` (Task 7)
- Produces:
  - `COLUMNAS` ampliado con las de `extra`, `visible: false`
  - `generarCsv(filas, columnas) -> string` con BOM UTF-8 y separador `;`
  - `descargar(nombre, contenido)`

- [ ] **Step 1: Añadir las columnas secundarias**

Añadir al final del array `COLUMNAS` en `src/ui.js`:

```js
COLUMNAS.push(
  { clave: 'beneficiario', titulo: 'Beneficiario', tipo: 'texto',
    visible: false, extra: true },
  { clave: 'iban', titulo: 'IBAN', tipo: 'texto', visible: false, extra: true },
  { clave: 'titular', titulo: 'Titular', tipo: 'texto', visible: false, extra: true },
  { clave: 'entidad', titulo: 'Entidad', tipo: 'texto', visible: false, extra: true },
  { clave: 'oficina', titulo: 'Oficina', tipo: 'texto', visible: false, extra: true },
  { clave: 'nuestraRef', titulo: 'Nuestra Refª', tipo: 'texto',
    visible: false, extra: true },
  { clave: 'importeOrigen', titulo: 'Importe origen', tipo: 'num',
    visible: false, extra: true },
  { clave: 'importeRecibido', titulo: 'Importe recibido', tipo: 'num',
    visible: false, extra: true },
  { clave: 'contravalor', titulo: 'Contravalor', tipo: 'num',
    visible: false, extra: true },
);

/** Valor de una columna, venga del registro o de registro.extra. */
function valorColumna(r, col) {
  return col.extra ? (r.extra[col.clave] ?? null) : r[col.clave];
}
```

Actualizar `celda` para que use `valorColumna`:

```js
function celda(r, col) {
  const v = valorColumna(r, col);
  if (col.clave === 'importe') {
    return el('td', { className: 'num', textContent: r.importeTexto || '—' });
  }
  if (col.tipo === 'fecha') {
    return el('td', { textContent: r[col.clave + 'Texto'] || '—' });
  }
  if (col.tipo === 'num' || col.tipo === 'importe') {
    return el('td', { className: 'num',
                      textContent: v === null || v === undefined ? '—' : String(v) });
  }
  return el('td', { textContent: v || '—' });
}
```

Y `ordenar` para que también funcione con las columnas de `extra`:

```js
function ordenar(registros, { clave, ascendente }) {
  const col = COLUMNAS.find(c => c.clave === clave);
  const signo = ascendente ? 1 : -1;
  return [...registros].sort((a, b) => {
    const va = valorColumna(a, col), vb = valorColumna(b, col);
    const na = va === null || va === undefined;
    const nb = vb === null || vb === undefined;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    if (va < vb) return -signo;
    if (va > vb) return signo;
    return 0;
  });
}
```

- [ ] **Step 2: Pintar el selector de columnas**

```js
function pintarColumnas() {
  const det = el('details');
  det.append(el('summary', { textContent: 'Columnas' }));
  const caja = el('div', { className: 'columnas' });
  for (const col of COLUMNAS) {
    const cb = el('input', { type: 'checkbox', checked: col.visible });
    cb.addEventListener('change', () => { col.visible = cb.checked; refrescar(); });
    caja.append(el('label', {}, [cb, ' ' + col.titulo]));
  }
  det.append(caja);
  return det;
}
```

Añadirlo en `pintarResultados`, justo antes de `el('p', { id: 'contador' …})`.

- [ ] **Step 3: Implementar el CSV**

```js
/**
 * CSV para Excel en espanol: separador ';' y BOM UTF-8. Con ',' y sin BOM,
 * Excel mete todo en una columna y rompe los acentos.
 */
function generarCsv(filas, columnas) {
  const escapar = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [columnas.map(c => escapar(c.titulo)).join(';')];
  for (const r of filas) {
    lineas.push(columnas.map(col => {
      if (col.clave === 'importe') return escapar(r.importeTexto);
      if (col.tipo === 'fecha') return escapar(r[col.clave + 'Texto']);
      return escapar(valorColumna(r, col));
    }).join(';'));
  }
  return '﻿' + lineas.join('\r\n');
}

function descargar(nombre, contenido) {
  const url = URL.createObjectURL(
    new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Añadir el botón**

En `pintarResultados`, junto al contador:

```js
  const exportar = el('button', { textContent: 'Exportar CSV' });
  exportar.addEventListener('click', () => {
    const visibles = COLUMNAS.filter(c => c.visible);
    const base = APP.nombreArchivo.replace(/\.pdf$/i, '');
    descargar(`${base}-filtrado.csv`, generarCsv(APP.filas, visibles));
  });
```

Y añadirlo al `app.append(...)`.

- [ ] **Step 5: Estilos del selector**

Añadir a `src/estilos.css`:

```css
.columnas { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 10px 0; }
.columnas label { font-size: 13px; display: flex; align-items: center; gap: 4px; }
details { margin: 12px 0; }
summary { cursor: pointer; }
```

- [ ] **Step 6: Construir y probar**

```bash
node build.js && open buscador.html
```

Comprobar: activar IBAN añade la columna; filtrar y exportar produce un CSV
con solo las filas filtradas y solo las columnas visibles; abrirlo con doble
clic en Excel reparte las columnas y respeta los acentos.

- [ ] **Step 7: Commit**

```bash
node build.js
git add src/ buscador.html
git commit -m "$(cat <<'EOF'
Selector de columnas y exportacion a CSV

Lo que se ve es lo que se exporta: filas filtradas y columnas visibles.
Separador ';' y BOM UTF-8, que es lo que Excel en espanol abre bien.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 9: Manejo de errores de carga

**Files:**
- Modify: `src/ui.js`

**Interfaces:**
- Consumes: `procesar` (Task 5)
- Produces: `abrirDocumento(datos, pedirContrasena) -> Promise<PDFDocumentProxy>`

- [ ] **Step 1: Implementar la apertura con contraseña y errores**

Sustituir en `src/ui.js` la obtención del documento dentro de `procesar`:

```js
/**
 * Abre el PDF pidiendo contrasena si hace falta. PDF.js avisa mediante
 * onPassword; se reintenta hasta que el usuario cancela.
 */
function abrirDocumento(datos) {
  const tarea = pdfjsLib.getDocument({ data: datos });
  tarea.onPassword = (reintentar, motivo) => {
    const texto = motivo === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      ? 'Contraseña incorrecta. Inténtalo de nuevo:'
      : 'El PDF está protegido. Introduce la contraseña:';
    const clave = prompt(texto);
    if (clave === null) tarea.destroy();
    else reintentar(clave);
  };
  return tarea.promise;
}
```

Y en `procesar`, sustituir el `catch` por:

```js
  } catch (err) {
    barra.classList.add('oculto');
    estado.className = 'sub aviso';
    const nombre = err && err.name;
    if (nombre === 'PasswordException') {
      estado.textContent = 'PDF protegido: no se introdujo la contraseña.';
    } else if (nombre === 'InvalidPDFException') {
      estado.textContent = 'Ese archivo no parece un PDF válido.';
    } else {
      estado.textContent = 'No se pudo procesar el archivo: ' + err.message;
    }
    return;
  }
```

- [ ] **Step 2: Avisar si ninguna página encaja**

Al principio de `pintarResultados`:

```js
  if (APP.registros.length === 0) {
    const app = document.getElementById('app');
    app.textContent = '';
    app.append(
      el('h1', { textContent: 'Buscador de transferencias' }),
      el('p', { className: 'aviso',
        textContent: 'Ninguna página encajó en el molde esperado. '
          + 'Puede que este PDF tenga otro formato, o que sea un escaneo '
          + 'sin capa de texto.' }),
      panelAnomalias(),
    );
    return;
  }
```

- [ ] **Step 3: Probar los tres casos**

```bash
node build.js && open buscador.html
```

- Soltar un fichero que no sea PDF (por ejemplo `README.md` renombrado a
  `.pdf`): esperado "Ese archivo no parece un PDF válido."
- Soltar el PDF de ejemplo: funciona igual que antes.
- Comprobar que un error no deja la barra de progreso girando.

- [ ] **Step 4: Commit**

```bash
node build.js
git add src/ui.js buscador.html
git commit -m "$(cat <<'EOF'
Errores de carga: contrasena, PDF invalido y molde no reconocido

Ningun fallo deja la interfaz colgada, y el aviso de "ninguna pagina
encajo" apunta a las dos causas probables en vez de a una traza.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
```

---

### Task 10: Documentación y verificación con el PDF real

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: nada. Es la comprobación final.

- [ ] **Step 1: Escribir el README**

```markdown
# buscador-transferencias-santander

Buscador local para extractos bancarios en PDF de miles de páginas.
Convierte el PDF en una tabla filtrable por ordenante, importe, concepto y
las tres fechas (operación, valor, envío), y la exporta a CSV.

## Uso

Abre `buscador.html` con doble clic y suelta el PDF encima. Nada más.

El PDF **no sale de tu equipo**: se procesa entero en el navegador.
`buscador.html` no hace ninguna petición de red. No queda nada guardado al
cerrar; hay que cargar el PDF en cada sesión.

## Desarrollo

```bash
# Descargar PDF.js (solo la primera vez)
mkdir -p vendor
curl -fSL -o vendor/pdf.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -fSL -o vendor/pdf.worker.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js

node --test test/    # tests del parser
node build.js        # genera buscador.html
```

PDF.js queda fijado en la 3.11.174: es la última versión con build UMD, y
los módulos ES de la 4 en adelante no funcionan bajo `file://`.

## Confidencialidad

Los extractos no se versionan: `.gitignore` excluye `*.pdf` y
`sondeo*.txt`. Los tests usan datos inventados; ningún fixture procede de un
documento real.

`sondeo_estructura.py` analiza la estructura de un PDF sin revelar su
contenido: conserva solo las palabras que se repiten en la mayoría de las
páginas (las etiquetas de la plantilla) y enmascara el resto por clase de
carácter. Sirve para volver a analizar el molde si el banco cambia el
formato.

    python3 sondeo_estructura.py extracto.pdf > sondeo.txt

## Documentación

- Diseño: `docs/superpowers/specs/2026-09-07-buscador-transferencias-pdf-design.md`
- Plan: `docs/superpowers/plans/2026-09-07-buscador-transferencias-pdf.md`
```

- [ ] **Step 2: Ejecutar la batería completa**

```bash
node --test test/
node build.js
git status --porcelain --ignored | grep '^!!'
```

Esperado: todos los tests pasan; `buscador.html` se genera; el PDF y
`sondeo.txt` siguen ignorados.

- [ ] **Step 3: Verificación con el PDF real — la hace el usuario**

Entregar estas instrucciones:

> Abre `buscador.html` con el PDF de 1500 páginas y dime tres cosas:
> el número de transferencias detectadas, cuántos segundos tardó, y el
> contenido del panel de anomalías (número de páginas y motivos). No hace
> falta nada más: con los motivos y el recuento se ajusta el parser.

Si aparecen anomalías, **no seguir adelante inventando**: recoger los
motivos, reproducirlos como un fixture nuevo en `test/fixtures/molde.js`,
escribir el test que falla y corregir el parser. Cada variante descubierta
en producción se convierte en un caso de test.

- [ ] **Step 4: Commit y push**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
README con uso, desarrollo y politica de confidencialidad

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M8dtBRzUtqZMCH6JMes4Pk
EOF
)"
git push origin main
```

---

## Notas para quien ejecute el plan

- **No abras el PDF del directorio de trabajo.** Contiene datos personales.
  Todo lo que hay que saber de su estructura está en el spec. Si necesitas
  volver a analizarla, ejecuta `sondeo_estructura.py`, que enmascara los
  valores, y pide al usuario que revise la salida antes de mirarla.
- **No inventes fixtures a partir del PDF real.** Los datos de prueba se
  inventan.
- Si una tarea revela que el molde del spec es incorrecto, para y consulta
  en lugar de adaptar los tests hasta que pasen.
