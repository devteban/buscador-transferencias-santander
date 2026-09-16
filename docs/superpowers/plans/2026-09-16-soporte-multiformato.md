# Soporte multiformato y carga de varios PDF — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La herramienta reconoce dos formatos de PDF bancario (orden de
transferencia y listado de movimientos), acepta varios PDF a la vez —de
cualquiera de los dos formatos, mezclados—, y acumula todo en una sola tabla
filtrable y exportable (CSV y PDF).

**Architecture:** Un despachador nuevo (`parsearPaginaAuto`) detecta el
formato de cada página a partir de sus fragmentos en bruto y reparte al
parser correspondiente. El parser del formato 1 (`parsearPagina`) no se
toca: sus 38 tests siguen valiendo. El formato 2 es una función nueva
(`parsearPaginaMovimientos`) que extrae varios registros por página. Dos
funciones compartidas (`normalizarImporte`, `agruparEnLineas`) ganan un
segundo parámetro opcional, retrocompatible, para lo que el formato 2
necesita y el 1 no. La interfaz pasa de un archivo a una lista de archivos,
acumulando resultados; el estado de "documento fuente para exportar a PDF"
pasa de una variable a un mapa por archivo.

**Tech Stack:** JavaScript sin framework. PDF.js 3.11.174 y pdf-lib 1.17.1,
ambos vendorizados e inlinados por `build.js`. `node --test` para los tests.

**Spec:** `docs/superpowers/specs/2026-09-16-soporte-multiformato-design.md`
(y el diseño original,
`docs/superpowers/specs/2026-09-07-buscador-transferencias-pdf-design.md`,
que sigue vigente en lo que este no contradice).

## Global Constraints

- **El camino del formato 1 no se toca.** `parsearPagina` conserva su firma
  y su comportamiento exactos. Los 38 tests existentes (`test/parser.test.js`
  + `test/integracion.test.js`) deben seguir pasando **sin modificarlos** en
  ningún momento del plan. Si una tarea los rompe, es un defecto de esa
  tarea, no un test a "arreglar".
- **`normalizarImporte` y `agruparEnLineas` ganan un segundo parámetro
  opcional.** Sin ese parámetro, comportamiento idéntico al actual byte a
  byte. Ninguna otra función compartida se modifica.
- **Ningún dato real en el repositorio ni en los tests.** `TRANSFERENCIAS
  RECIBIDAS.pdf` y `MovimientosCuenta ok.pdf` están en `.gitignore` (`*.pdf`)
  y **no deben abrirse** salvo para el sondeo ya hecho. Todos los fixtures
  son inventados.
- **`buscador.html` no hace ninguna petición de red.** `vendor/pdf.min.js`,
  `vendor/pdf.worker.min.js` y `vendor/pdf-lib.min.js`, inlinados por
  `build.js`. Ninguna línea de `src/ui.js` ni `src/parser.js` puede empezar
  literalmente por `export ` fuera de una declaración real: `build.js`
  borra esa palabra al principio de línea con `replace(/^export /gm, '')`.
- **Importes**: solo formato español (`.` miles, `,` decimales). Fechas de
  campo: `dd-mm-aaaa` en el formato 1, `dd/mm/aaaa` en el formato 2 (ambos
  se normalizan a ISO con la misma `normalizarFecha`, convirtiendo `/` a
  `-` antes de llamarla). Lo que no encaje es anomalía, nunca una
  interpretación alternativa.
- **Confidencialidad de las anomalías**: solo archivo, número de página,
  número de fila (si aplica), motivo y nombres de campo. Nunca contenido.
- Identificadores en español sin acentos; comentarios en español; textos de
  interfaz en español con acentos correctos.
- Comandos de test: `node --test test/*.test.js` (la forma `node --test
  test/` no funciona).
- Mensajes de commit en español, terminados en:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
  ```

## Estructura de ficheros

| Fichero | Cambio |
|---|---|
| `src/parser.js` | `normalizarImporte`/`agruparEnLineas` con opciones; nuevas `tolerenciaAdaptativa`, `detectarFormato`, `parsearPaginaMovimientos`, `parsearPaginaAuto` |
| `src/ui.js` | carga múltiple, acumulación, progreso por archivo, `APP.documentosPorArchivo`, columnas nuevas, aviso de truncado |
| `test/parser.test.js` | se amplía (nunca se modifica lo existente) con tests de las opciones nuevas |
| `test/fixtures/molde.js` | se amplía con constructores para el formato 2 |
| `test/parser-movimientos.test.js` | nuevo: detección de formato, tolerancia adaptativa, extracción del formato 2 |
| `test/integracion-movimientos.test.js` | nuevo: PDF sintético → tabla, formato 2 |
| `test/fixtures/generar_pdf_prueba_movimientos.py` | nuevo: PDF sintético del formato 2, con la geometría real (fuente pequeña, filas partidas) |
| `test/fixtures/extraer_items_movimientos.py` | nuevo: extrae los fragmentos de ese PDF a JSON, como ya existe para el formato 1 |
| `test/fixtures/items-pdf-prueba-movimientos.json` | nuevo, generado |
| `README.md` | formatos admitidos, carga múltiple, limitación del truncado |

---

### Task 1: `normalizarImporte` y `agruparEnLineas` con opciones retrocompatibles

**Files:**
- Modify: `src/parser.js:8-17` (`normalizarImporte`), `src/parser.js:49-87` (`agruparEnLineas`)
- Modify: `test/parser.test.js` (solo añadir al final, nunca tocar lo existente)

**Interfaces:**
- Consumes: nada nuevo
- Produces:
  - `normalizarImporte(texto, opciones)` — `opciones.permitirNegativo` (bool, por defecto `false`)
  - `agruparEnLineas(items, opciones)` — `opciones.tolerancia` (number fijo; si se omite, comportamiento actual)

- [ ] **Step 1: Confirmar la base — los 38 tests actuales pasan**

Run: `node --test test/*.test.js`
Expected: `tests 38`, `pass 38`, `fail 0`. Si no, parar: algo ya está roto antes de empezar.

- [ ] **Step 2: Escribir los tests que fallan**

Añadir a `test/parser.test.js` (al final del fichero, sin tocar nada anterior):

```js
test('normalizarImporte: sin opciones, comportamiento identico al actual', () => {
  assert.equal(normalizarImporte('1.234,56'), 1234.56);
  assert.equal(normalizarImporte('-1.234,56'), null); // rechazado, como hoy
});

test('normalizarImporte: con permitirNegativo, acepta el signo delante', () => {
  assert.equal(normalizarImporte('-1.234,56', { permitirNegativo: true }), -1234.56);
  assert.equal(normalizarImporte('-345,00', { permitirNegativo: true }), -345);
});

test('normalizarImporte: con permitirNegativo, acepta el signo detras', () => {
  assert.equal(normalizarImporte('1.234,56-', { permitirNegativo: true }), -1234.56);
});

test('normalizarImporte: permitirNegativo no relaja el resto de reglas', () => {
  // Formato ingles, espacio interno, sin decimales: siguen rechazados.
  assert.equal(normalizarImporte('-1,234.56', { permitirNegativo: true }), null);
  assert.equal(normalizarImporte('-12 3,45', { permitirNegativo: true }), null);
  assert.equal(normalizarImporte('-1234', { permitirNegativo: true }), null);
});

test('normalizarImporte: sin permitirNegativo, un signo detras tambien se rechaza', () => {
  assert.equal(normalizarImporte('1.234,56-'), null);
});

test('agruparEnLineas: sin opciones, comportamiento identico al actual', () => {
  const items = [item(10, 700, 'A'), item(60, 698, 'B'), item(10, 680, 'C')];
  const lineas = agruparEnLineas(items);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].texto, 'A B');
});

test('agruparEnLineas: con tolerancia fija, une fragmentos que la tolerancia por defecto separaria', () => {
  // altura 4 -> tolerancia por defecto max(2, 4*0.5) = 2; separados 3.6 no
  // se unirian por defecto, pero si con una tolerancia fija de 6.
  const items = [item(10, 700, 'FECHA', 4), item(300, 696.4, 'IMPORTE', 4)];
  const sinOpciones = agruparEnLineas(items);
  assert.equal(sinOpciones.length, 2); // se parte, como hoy sin ayuda

  const conTolerancia = agruparEnLineas(items, { tolerancia: 6 });
  assert.equal(conTolerancia.length, 1);
  assert.equal(conTolerancia[0].texto, 'FECHA IMPORTE');
});

test('agruparEnLineas: la tolerancia fija tambien separa filas mas alla de ella', () => {
  const items = [item(10, 700, 'FILA1', 4), item(10, 689, 'FILA2', 4)]; // salto 11
  const lineas = agruparEnLineas(items, { tolerancia: 6 });
  assert.equal(lineas.length, 2);
});
```

- [ ] **Step 2b: Añadir el import de `item` que falta**

Comprueba la cabecera de `test/parser.test.js`: ya importa `item` y `linea`
de `./fixtures/molde.js` (usados por tests anteriores). Si por lo que sea no
estuviera, añade `import { item, linea, paginaMolde } from './fixtures/molde.js';`
— pero lo normal es que ya esté.

- [ ] **Step 3: Verificar que fallan**

Run: `node --test test/*.test.js`
Expected: FAIL — los tests nuevos fallan (comportamiento aún no implementado); los 38 anteriores siguen en PASS.

- [ ] **Step 4: Implementar `normalizarImporte` con opciones**

Sustituir en `src/parser.js` (líneas 8-17):

```js
export function normalizarImporte(texto, opciones) {
  if (typeof texto !== 'string') return null;
  // Se recortan los extremos y el codigo de moneda, pero NUNCA los espacios
  // internos: el texto viene de fragmentos de PDF unidos con espacios, y
  // borrarlos convertiria "12 3,45" en un importe valido de 123,45.
  let limpio = texto.trim().replace(/\s*[A-Z]{3}$/, '').trim();
  let negativo = false;
  // El formato de movimientos puede traer cargos con el signo delante o
  // detras (las dos convenciones habituales en extractos). Sin
  // permitirNegativo, el comportamiento es EXACTAMENTE el de antes: un
  // signo simplemente no encaja en RE_IMPORTE y da null, como siempre.
  if (opciones && opciones.permitirNegativo) {
    if (limpio.startsWith('-')) { negativo = true; limpio = limpio.slice(1).trim(); }
    else if (limpio.endsWith('-')) { negativo = true; limpio = limpio.slice(0, -1).trim(); }
  }
  if (!RE_IMPORTE.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}
```

- [ ] **Step 5: Implementar `agruparEnLineas` con opciones**

Sustituir en `src/parser.js` (líneas 49-87), cambiando solo la línea del
cálculo de `tol` dentro del bucle:

```js
export function agruparEnLineas(items, opciones) {
  // Se ordena por Y antes de agrupar para que el resultado no dependa del
  // orden en que PDF.js emita los fragmentos, y se compara cada fragmento
  // con el ANTERIOR en vez de con un ancla fija: asi una linea ancha con
  // deriva vertical acumulada no se parte por la mitad.
  const utiles = (items || [])
    .filter(it => it && it.str && it.str.trim())
    .map(it => ({
      x: it.transform[4],
      y: it.transform[5],
      altura: it.height || Math.abs(it.transform[3]) || 10,
      texto: it.str.trim(),
    }))
    .sort((a, b) => b.y - a.y);
  if (utiles.length === 0) return [];

  const tolFija = opciones && typeof opciones.tolerancia === 'number'
    ? opciones.tolerancia : null;

  const grupos = [];
  let actual = null;
  let anterior = null;
  for (const f of utiles) {
    // La tolerancia es la mayor de las dos alturas implicadas, para que
    // unir A con B de el mismo resultado que unir B con A. Si se paso una
    // tolerancia fija (formatos tabulares con geometria propia), se usa esa
    // en vez de calcularla de la altura de fuente.
    const tol = tolFija !== null ? tolFija
      : anterior === null ? 0
      : Math.max(toleranciaY(f.altura), toleranciaY(anterior.altura));
    if (actual === null || Math.abs(anterior.y - f.y) > tol) {
      actual = { y: f.y, fragmentos: [] };
      grupos.push(actual);
    }
    actual.fragmentos.push({ x: f.x, texto: f.texto });
    anterior = f;
  }

  for (const g of grupos) {
    g.fragmentos.sort((a, b) => a.x - b.x);
    g.texto = g.fragmentos.map(f => f.texto).join(' ');
  }
  return grupos;
}
```

- [ ] **Step 6: Verificar que todo pasa**

Run: `node --test test/*.test.js`
Expected: PASS, 46 tests (38 anteriores + 8 nuevos).

- [ ] **Step 7: Regenerar el build y confirmar que sigue sin red**

```bash
node build.js
grep -oE '(src|href)="https?://[^"]*"' buscador.html || echo "sin peticiones externas"
```

- [ ] **Step 8: Commit**

```bash
git add src/parser.js test/parser.test.js buscador.html
git commit -m "$(cat <<'EOF'
Anadir opciones retrocompatibles a normalizarImporte y agruparEnLineas

permitirNegativo (importes) y tolerancia fija (agrupacion de lineas), los
dos necesarios para el formato de listado de movimientos. Sin opciones,
el comportamiento es identico al actual: los 38 tests previos no se tocan
y siguen en verde.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 2: `detectarFormato` y `tolerenciaAdaptativa`

**Files:**
- Modify: `src/parser.js` (añadir al final, después de `parsearPagina`)
- Modify: `test/parser.test.js` (añadir al final)

**Interfaces:**
- Consumes: nada de tareas anteriores directamente (funciones puras sobre `items` en bruto de PDF.js — `{str, transform, height}`)
- Produces:
  - `detectarFormato(items) -> 'transferencia' | 'movimientos' | null`
  - `tolerenciaAdaptativa(items) -> number | null`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `test/parser.test.js`:

```js
test('detectarFormato: reconoce el marcador de transferencia', () => {
  const items = [item(20, 700, 'TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA')];
  assert.equal(detectarFormato(items), 'transferencia');
});

test('detectarFormato: reconoce un listado de movimientos por la forma de las filas', () => {
  const items = [];
  for (let i = 0; i < 4; i++) {
    items.push(item(20, 700 - i * 12, `0${i + 1}/01/2025`));
    items.push(item(400, 700 - i * 12, `1.234,5${i} EUR`.replace(' EUR', '')));
  }
  assert.equal(detectarFormato(items), 'movimientos');
});

test('detectarFormato: con menos de 3 fechas o 3 importes, no lo clasifica como movimientos', () => {
  const items = [item(20, 700, '01/01/2025'), item(400, 700, '10,00'),
                 item(20, 688, 'texto suelto sin mas filas')];
  assert.equal(detectarFormato(items), null);
});

test('detectarFormato: pagina vacia o sin ninguna forma reconocible da null', () => {
  assert.equal(detectarFormato([]), null);
  assert.equal(detectarFormato([item(20, 700, 'texto cualquiera sin forma')]), null);
});

test('tolerenciaAdaptativa: separa dos grupos de saltos y devuelve el punto medio', () => {
  // Filas de dos sub-alturas (salto 3.6 dentro, salto 10.2 entre filas),
  // reproduciendo la geometria medida en el documento real.
  const items = [];
  let y = 700;
  for (let f = 0; f < 6; f++) {
    items.push(item(20, y, 'A'));
    items.push(item(300, y - 3.6, 'B'));
    y -= 10.2;
  }
  const tol = tolerenciaAdaptativa(items);
  assert.ok(tol > 3.6 && tol < 10.2, `tolerancia ${tol} deberia caer entre 3.6 y 10.2`);
});

test('tolerenciaAdaptativa: con pocos saltos distintos, no hay evidencia suficiente', () => {
  const items = [item(20, 700, 'A'), item(20, 695, 'B')];
  assert.equal(tolerenciaAdaptativa(items), null);
});

test('tolerenciaAdaptativa: pagina vacia da null', () => {
  assert.equal(tolerenciaAdaptativa([]), null);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `node --test test/*.test.js`
Expected: FAIL, `detectarFormato is not defined`.

- [ ] **Step 3: Implementar**

Añadir al final de `src/parser.js`:

```js
// ============================================================================
// FORMATO: listado de movimientos (muchas filas por pagina)
// ============================================================================

const RE_FECHA_SLASH_INICIO = /^\s*\d{2}\/\d{2}\/\d{4}/;
const RE_IMPORTE_FIN = /(-?[\d.]*\d,\d{2}-?)\s*$/;

/**
 * Formato de la pagina, a partir de los fragmentos EN BRUTO de PDF.js (no
 * lineas ya agrupadas): la reconstruccion de lineas necesita una tolerancia
 * que depende del formato, asi que la deteccion tiene que ir antes.
 */
export function detectarFormato(items) {
  const utiles = (items || []).filter(it => it && it.str && it.str.trim());
  if (utiles.length === 0) return null;
  const texto = utiles.map(it => it.str).join(' ');
  if (texto.includes(MARCADOR)) return 'transferencia';
  const conFecha = utiles.filter(it => RE_FECHA_SLASH_INICIO.test(it.str)).length;
  const conImporte = utiles.filter(it => RE_IMPORTE_FIN.test(it.str)).length;
  return (conFecha >= 3 && conImporte >= 3) ? 'movimientos' : null;
}

/**
 * Tolerancia vertical calculada de la propia pagina, para formatos donde
 * cada fila se reparte en varias sub-alturas de PDF.js (ver el diseno: en
 * el documento real, salto intra-fila 3.6, salto entre filas 10.2, y la
 * tolerancia por defecto de agruparEnLineas -altura*0.5- es menor que el
 * salto intra-fila, asi que parte cada fila en dos).
 *
 * Se buscan los saltos verticales entre coordenadas Y distintas, se ordenan
 * de menor a mayor, y se localiza el mayor salto RELATIVO entre dos
 * consecutivos: la frontera entre "dentro de una fila" y "entre filas". La
 * tolerancia devuelta es el punto medio de esa frontera.
 *
 * Con menos de 5 saltos distintos no hay evidencia suficiente para separar
 * dos grupos, y se devuelve null (el llamante debe usar entonces la
 * tolerancia por defecto).
 */
export function tolerenciaAdaptativa(items) {
  const ys = [...new Set((items || [])
    .filter(it => it && it.str && it.str.trim())
    .map(it => it.transform[5]))]
    .sort((a, b) => b - a);
  if (ys.length < 6) return null;
  const saltos = [];
  for (let i = 1; i < ys.length; i++) saltos.push(ys[i - 1] - ys[i]);
  saltos.sort((a, b) => a - b);
  let mejorIdx = -1, mejorRatio = 1;
  for (let i = 0; i < saltos.length - 1; i++) {
    if (saltos[i] <= 0) continue;
    const ratio = saltos[i + 1] / saltos[i];
    if (ratio > mejorRatio) { mejorRatio = ratio; mejorIdx = i; }
  }
  if (mejorIdx === -1) return null;
  return (saltos[mejorIdx] + saltos[mejorIdx + 1]) / 2;
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `node --test test/*.test.js`
Expected: PASS, 53 tests (46 + 7 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/parser.js test/parser.test.js
git commit -m "$(cat <<'EOF'
Anadir deteccion de formato y tolerancia vertical adaptativa

detectarFormato clasifica una pagina a partir de sus fragmentos en bruto,
antes de reconstruir lineas: el listado de movimientos necesita una
tolerancia distinta a la del formato de transferencia, y esa tolerancia
solo puede calcularse una vez sabido que formato es.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 3: Fixture del formato 2 y `parsearPaginaMovimientos`

Esta es la tarea central: extraer varios registros de una sola página.

**Files:**
- Modify: `test/fixtures/molde.js` (añadir al final)
- Create: `test/parser-movimientos.test.js`
- Modify: `src/parser.js` (añadir al final)

**Interfaces:**
- Consumes: `agruparEnLineas`, `normalizarImporte`, `normalizarFecha`, `normalizarTexto`, `tolerenciaAdaptativa` (Tasks 1-2); `item` (de `test/fixtures/molde.js`, ya existente)
- Produces:
  - `parsearPaginaMovimientos(lineas, numeroPagina, archivo) -> { registros: Registro[], anomalias: Anomalia[] }`
  - Añade a `test/fixtures/molde.js`: `filaMovimientos(y, opciones)`, `paginaMovimientos(filas, opciones)`

- [ ] **Step 1: Escribir el constructor de fixtures**

Añadir al final de `test/fixtures/molde.js`:

```js
/**
 * Fragmentos de UNA fila de un listado de movimientos, reproduciendo la
 * geometria real: la fila se reparte en dos sub-alturas de PDF.js (salto
 * 3.6, menor que la fuente) y las filas entre si van separadas ~10.2
 * (mayor que la fuente). Sin esta geometria el fixture no ejercitaria el
 * problema que motivo el diseno: con la tolerancia por defecto de
 * agruparEnLineas, la fila se parte en dos lineas y el parser no la ve.
 *
 * Todos los valores son inventados.
 */
export function filaMovimientos(yBase, opciones = {}) {
  const o = {
    fechaOperacion: '16/03/2025',
    fechaValor: '17/03/2025',
    descripcion: 'Transferencia De Ayuntamiento De Villarriba, Concepto Servicio 123',
    importe: '1.234,56',
    alturaFuente: 4.68,
    ...opciones,
  };
  const frags = [
    item(20, yBase, o.fechaOperacion, o.alturaFuente),
    item(90, yBase, o.fechaValor, o.alturaFuente),
  ];
  if (o.descripcion) frags.push(item(160, yBase - 3.6, o.descripcion, o.alturaFuente));
  if (o.importe !== null) frags.push(item(600, yBase - 3.6, o.importe, o.alturaFuente));
  return frags;
}

/**
 * Pagina sintetica de listado de movimientos: titulo, cabecera de columnas
 * (solo en la primera pagina del documento, como en el molde real) y N
 * filas separadas ~10.2. `filas` es un array de opciones para
 * `filaMovimientos` (una entrada por fila).
 */
export function paginaMovimientos(filas, opciones = {}) {
  const o = { conCabecera: true, ...opciones };
  const items = [];
  let y = 760;
  if (o.conCabecera) {
    items.push(...[
      item(20, y, 'Movimientos cuenta desde 01/01/2025 hasta 31/12/2025'),
    ]);
    y -= 20;
    items.push(
      item(20, y, 'Fecha Operacion'), item(90, y, 'Fecha Valor'),
      item(160, y, 'Concepto'), item(600, y, 'Importe'),
    );
    y -= 20;
  }
  for (const opcionesFila of filas) {
    items.push(...filaMovimientos(y, opcionesFila));
    y -= 10.2;
  }
  return items;
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `test/parser-movimientos.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparEnLineas, tolerenciaAdaptativa, parsearPaginaMovimientos,
} from '../src/parser.js';
import { filaMovimientos, paginaMovimientos } from './fixtures/molde.js';

/** Agrupa con la tolerancia adaptativa de la propia pagina, como hace
 * parsearPaginaAuto (Task 4) antes de llamar a parsearPaginaMovimientos. */
function lineasDe(items) {
  const tol = tolerenciaAdaptativa(items);
  return agruparEnLineas(items, tol !== null ? { tolerancia: tol } : undefined);
}

test('parsearPaginaMovimientos: extrae los cuatro campos del nucleo de una fila', () => {
  const items = paginaMovimientos([{}]); // una fila con los valores por defecto
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineasDe(items), 5, 'extracto.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 1);
  const r = registros[0];
  assert.equal(r.pagina, 5);
  assert.equal(r.archivo, 'extracto.pdf');
  assert.equal(r.formato, 'movimientos');
  assert.equal(r.fila, 1);
  assert.equal(r.fechaOperacion, '2025-03-16');
  assert.equal(r.fechaOperacionTexto, '16/03/2025');
  assert.equal(r.fechaValor, '2025-03-17');
  assert.equal(r.ordenante, 'Ayuntamiento De Villarriba');
  assert.equal(r.concepto, 'Servicio 123');
  assert.equal(r.importe, 1234.56);
  assert.equal(r.importeTexto, '1.234,56');
  assert.equal(r.fechaEnvio, null);
  assert.equal(r.fechaEnvioTexto, null);
});

test('parsearPaginaMovimientos: varias filas dan varios registros con fila incremental', () => {
  const items = paginaMovimientos([
    { importe: '100,00' }, { importe: '200,00' }, { importe: '300,00' },
  ]);
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineasDe(items), 1, 'a.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 3);
  assert.deepEqual(registros.map(r => r.fila), [1, 2, 3]);
  assert.deepEqual(registros.map(r => r.importe), [100, 200, 300]);
});

test('parsearPaginaMovimientos: fila sin la palabra Concepto no genera anomalia', () => {
  // Verificado contra el documento real: hay filas legitimas sin Concepto.
  const items = paginaMovimientos([
    { descripcion: 'Transferencia De Ayuntamiento De Villabajo' },
  ]);
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineasDe(items), 1, 'a.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros[0].concepto, null);
  assert.equal(registros[0].ordenante, 'Ayuntamiento De Villabajo');
});

test('parsearPaginaMovimientos: ordenante con coma interna no se trunca', () => {
  // La regla corta por ", Concepto", nunca por la primera coma: hay
  // ordenantes reales con sufijos societarios que contienen comas.
  const items = paginaMovimientos([
    { descripcion: 'Transferencia De Empresa Ejemplo, S.L., Concepto Factura 9' },
  ]);
  const { registros } = parsearPaginaMovimientos(lineasDe(items), 1, 'a.pdf');
  assert.equal(registros[0].ordenante, 'Empresa Ejemplo, S.L.');
  assert.equal(registros[0].concepto, 'Factura 9');
});

test('parsearPaginaMovimientos: fila sin estructura "De ... Concepto" va entera al concepto', () => {
  // Un listado de movimientos puede traer filas que no sean transferencias
  // (comisiones, recibos): no se ancla la deteccion en la palabra
  // "Transferencia".
  const items = paginaMovimientos([{ descripcion: 'Comision mantenimiento cuenta' }]);
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineasDe(items), 1, 'a.pdf');
  assert.equal(registros[0].ordenante, null);
  assert.equal(registros[0].concepto, 'Comision mantenimiento cuenta');
  assert.ok(anomalias.some(a => a.camposFaltantes.includes('ordenante')));
});

test('parsearPaginaMovimientos: importe negativo con signo delante y detras', () => {
  const items = paginaMovimientos([
    { importe: '-50,00' }, { importe: '75,00-' },
  ]);
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineasDe(items), 1, 'a.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros[0].importe, -50);
  assert.equal(registros[1].importe, -75);
});

test('parsearPaginaMovimientos: fila con importe ilegible entra igual, con anomalia', () => {
  const items = paginaMovimientos([{ importe: 'texto-no-importe' }]);
  const { registros, anomalias } = parsearPaginaMovimientos(
    lineasDe(items), 3, 'a.pdf');
  assert.equal(registros.length, 1); // no desaparece
  assert.equal(registros[0].importe, null);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].pagina, 3);
  assert.equal(anomalias[0].archivo, 'a.pdf');
  assert.equal(anomalias[0].fila, 1);
  assert.equal(anomalias[0].motivo, 'campos_incompletos');
  assert.deepEqual(anomalias[0].camposFaltantes, ['importe']);
});

test('parsearPaginaMovimientos: la cabecera y el titulo no se confunden con filas', () => {
  const items = paginaMovimientos([{}], { conCabecera: true });
  const { registros } = parsearPaginaMovimientos(lineasDe(items), 1, 'a.pdf');
  assert.equal(registros.length, 1); // solo la fila real, no titulo ni cabecera
});

test('parsearPaginaMovimientos: pagina sin ninguna fila da lista vacia sin anomalia de pagina', () => {
  const { registros, anomalias } = parsearPaginaMovimientos([], 1, 'a.pdf');
  assert.deepEqual(registros, []);
  assert.deepEqual(anomalias, []);
});

test('parsearPaginaMovimientos: campos de busqueda normalizados', () => {
  const items = paginaMovimientos([{
    descripcion: 'Transferencia De Ayuntamiento De Alcalá, Concepto Limpieza Viaria',
  }]);
  const { registros } = parsearPaginaMovimientos(lineasDe(items), 1, 'a.pdf');
  assert.equal(registros[0].ordenanteBusqueda, 'ayuntamiento de alcala');
  assert.equal(registros[0].conceptoBusqueda, 'limpieza viaria');
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `node --test test/*.test.js`
Expected: FAIL, `parsearPaginaMovimientos is not a function`. Los 53 tests anteriores en PASS.

- [ ] **Step 4: Implementar `parsearPaginaMovimientos`**

Añadir al final de `src/parser.js`:

```js
const CAMPOS_NUCLEO_MOVIMIENTOS = ['fechaOperacion', 'fechaValor', 'ordenante', 'importe'];
const RE_FECHA_SLASH_GLOBAL = /\d{2}\/\d{2}\/\d{4}/g;

/** Registro vacio del formato movimientos, con la misma forma que el resto
 * de Registro (mismas claves que produce parsearPagina) para que
 * filtrar/ordenar/generarCsv en la interfaz no tengan que distinguir. */
function registroVacioMovimientos(pagina, archivo, fila) {
  return {
    pagina, archivo, formato: 'movimientos', fila,
    ordenante: null, ordenanteBusqueda: '',
    importe: null, importeTexto: null, moneda: null,
    concepto: null, conceptoBusqueda: '',
    fechaOperacion: null, fechaOperacionTexto: null,
    fechaValor: null, fechaValorTexto: null,
    fechaEnvio: null, fechaEnvioTexto: null,
    extra: {},
  };
}

/**
 * Extrae ordenante y concepto de la descripcion de una fila (el texto entre
 * las dos fechas y el importe). Se corta por la etiqueta ", Concepto",
 * NUNCA por la primera coma: hay ordenantes reales con sufijos societarios
 * que contienen comas (verificado: 2 de 134 filas del documento real).
 *
 * Si no hay " De " en la descripcion, no se asume que es una transferencia
 * (un listado de movimientos puede traer comisiones, recibos, etc): la
 * descripcion entera pasa a concepto y el ordenante queda sin rellenar.
 */
function extraerOrdenanteConcepto(descripcion) {
  const iDe = descripcion.indexOf(' De ');
  if (iDe === -1) {
    const c = descripcion.trim();
    return { ordenante: null, concepto: c || null };
  }
  const resto = descripcion.slice(iDe + 4);
  const iConceptoComa = resto.indexOf(', Concepto');
  if (iConceptoComa === -1) {
    const ord = resto.trim().replace(/,\s*$/, '');
    return { ordenante: ord || null, concepto: null };
  }
  const ordenante = resto.slice(0, iConceptoComa).trim();
  const iEtiqueta = resto.indexOf('Concepto', iConceptoComa);
  const concepto = resto.slice(iEtiqueta + 'Concepto'.length).trim();
  return { ordenante: ordenante || null, concepto: concepto || null };
}

/**
 * Extrae un registro de una linea con forma de fila (empieza por fecha,
 * termina en importe). Devuelve null si la linea no tiene al menos dos
 * fechas dd/mm/aaaa (no es una fila de datos: titulo, cabecera...).
 */
function parsearFilaMovimiento(lineaTexto, pagina, archivo, fila) {
  const fechas = [...lineaTexto.matchAll(RE_FECHA_SLASH_GLOBAL)];
  if (fechas.length < 2) return null;

  const reg = registroVacioMovimientos(pagina, archivo, fila);

  const isoOp = normalizarFecha(fechas[0][0].replace(/\//g, '-'));
  if (isoOp) { reg.fechaOperacion = isoOp; reg.fechaOperacionTexto = fechas[0][0]; }
  const isoVal = normalizarFecha(fechas[1][0].replace(/\//g, '-'));
  if (isoVal) { reg.fechaValor = isoVal; reg.fechaValorTexto = fechas[1][0]; }

  const finFechas = fechas[1].index + fechas[1][0].length;
  const tokens = lineaTexto.trim().split(/\s+/);
  const ultimoToken = tokens[tokens.length - 1];
  // El importe se valida ENTERO (todo el ultimo token), nunca con un regex
  // parcial: la misma regla que ya rige en parsearPagina, por el mismo
  // motivo (evitar leer un fragmento de numero como si fuera el importe).
  const importe = normalizarImporte(ultimoToken, { permitirNegativo: true });
  if (importe !== null) {
    reg.importe = importe;
    reg.importeTexto = ultimoToken;
  }

  // La descripcion es lo que queda entre el final de las dos fechas y el
  // inicio del ultimo token (el importe), reconociendolo aunque no haya
  // validado como numero (para no perder el texto en una fila con importe
  // ilegible).
  const iUltimoToken = lineaTexto.lastIndexOf(ultimoToken);
  const descripcion = lineaTexto.slice(finFechas, iUltimoToken).trim();
  const { ordenante, concepto } = extraerOrdenanteConcepto(descripcion);
  if (ordenante) { reg.ordenante = ordenante; reg.ordenanteBusqueda = normalizarTexto(ordenante); }
  if (concepto) { reg.concepto = concepto; reg.conceptoBusqueda = normalizarTexto(concepto); }

  return reg;
}

/**
 * Extrae TODOS los registros de una pagina de listado de movimientos: a
 * diferencia de parsearPagina (un registro por pagina), aqui cada linea con
 * forma de fila produce su propio registro. Las lineas que no tengan esa
 * forma (titulo, cabecera de columnas) se ignoran sin generar anomalia: son
 * texto fijo de la pagina, no filas de datos con un campo roto.
 */
export function parsearPaginaMovimientos(lineas, numeroPagina, archivo) {
  const registros = [];
  const anomalias = [];
  let fila = 0;
  for (const l of lineas || []) {
    if (!RE_FECHA_SLASH_INICIO.test(l.texto)) continue;
    fila++;
    const reg = parsearFilaMovimiento(l.texto, numeroPagina, archivo, fila);
    if (!reg) continue;
    registros.push(reg);
    const faltantes = CAMPOS_NUCLEO_MOVIMIENTOS.filter(c => reg[c] === null);
    if (faltantes.length > 0) {
      anomalias.push({
        pagina: numeroPagina, archivo, fila,
        motivo: 'campos_incompletos', camposFaltantes: faltantes,
      });
    }
  }
  return { registros, anomalias };
}
```

- [ ] **Step 5: Verificar que pasan**

Run: `node --test test/*.test.js`
Expected: PASS, 63 tests (53 + 10 nuevos).

- [ ] **Step 6: Commit**

```bash
git add src/parser.js test/fixtures/molde.js test/parser-movimientos.test.js
git commit -m "$(cat <<'EOF'
Extraer los registros del formato de listado de movimientos

parsearPaginaMovimientos extrae VARIOS registros por pagina, uno por fila
con forma de fila de datos. Nucleo de 4 campos (sin fecha de envio, que
este formato no tiene, y sin concepto obligatorio: hay filas legitimas
sin el, verificado contra el documento real). El ordenante se corta por
la etiqueta ", Concepto", nunca por la primera coma, porque hay
ordenantes con comas internas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 4: `parsearPaginaAuto` — el despachador, y la prueba de integración

**Files:**
- Modify: `src/parser.js` (añadir al final)
- Create: `test/fixtures/generar_pdf_prueba_movimientos.py`
- Create: `test/fixtures/extraer_items_movimientos.py`
- Create: `test/integracion-movimientos.test.js`
- Modify: `test/parser.test.js` (añadir al final: tests del despachador sobre el formato 1)

**Interfaces:**
- Consumes: `detectarFormato`, `tolerenciaAdaptativa`, `agruparEnLineas`, `parsearPagina`, `parsearPaginaMovimientos` (Tasks 1-3)
- Produces: `parsearPaginaAuto(items, numeroPagina, archivo) -> { registros: Registro[], anomalias: Anomalia[] }` — punto de entrada único que usará la interfaz (Task 5)

- [ ] **Step 1: Escribir los tests que fallan (formato 1 a traves del despachador)**

Añadir a `test/parser.test.js`:

```js
test('parsearPaginaAuto: formato transferencia, sigue devolviendo el registro correcto', () => {
  const items = [];
  // Reutiliza la geometria de paginaMolde, pero via items en bruto: se
  // construye a mano una pagina minima con el marcador y los datos del
  // nucleo, para no depender de convertir lineas ya agrupadas a items.
  const L = paginaMoldeItems();
  const { registros, anomalias } = parsearPaginaAuto(L, 7, 'transferencias.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].formato, 'transferencia');
  assert.equal(registros[0].archivo, 'transferencias.pdf');
  assert.equal(registros[0].fila, null);
  assert.equal(registros[0].pagina, 7);
  assert.equal(registros[0].ordenante, 'AYUNTAMIENTO DE VILLARRIBA');
});

test('parsearPaginaAuto: formato movimientos, varios registros con archivo y fila', () => {
  const items = paginaMovimientos([{ importe: '10,00' }, { importe: '20,00' }]);
  const { registros, anomalias } = parsearPaginaAuto(items, 2, 'movimientos.pdf');
  assert.equal(anomalias.length, 0);
  assert.equal(registros.length, 2);
  assert.equal(registros[0].formato, 'movimientos');
  assert.equal(registros[0].archivo, 'movimientos.pdf');
  assert.deepEqual(registros.map(r => r.fila), [1, 2]);
});

test('parsearPaginaAuto: pagina sin texto da anomalia sin_texto y ningun registro', () => {
  const { registros, anomalias } = parsearPaginaAuto([], 1, 'a.pdf');
  assert.deepEqual(registros, []);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].motivo, 'sin_texto');
  assert.equal(anomalias[0].archivo, 'a.pdf');
  assert.equal(anomalias[0].pagina, 1);
});

test('parsearPaginaAuto: pagina que no encaja en ningun formato da formato_no_reconocido', () => {
  const items = [item(20, 700, 'una pagina cualquiera sin forma reconocible')];
  const { registros, anomalias } = parsearPaginaAuto(items, 4, 'a.pdf');
  assert.deepEqual(registros, []);
  assert.equal(anomalias.length, 1);
  assert.equal(anomalias[0].motivo, 'formato_no_reconocido');
  assert.equal(anomalias[0].pagina, 4);
  assert.equal(anomalias[0].archivo, 'a.pdf');
});
```

Añadir también, en `test/parser.test.js`, el helper que falta (antes de los
tests, junto a las demás importaciones — no toca ningún test existente):

```js
/** Construye los items en bruto (formato PDF.js) de una pagina de
 * transferencia minima, para probar parsearPaginaAuto sin pasar por
 * paginaMolde (que ya da lineas agrupadas, no items). */
function paginaMoldeItems() {
  return [
    item(20, 760, 'TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA'),
    item(20, 720, 'AYUNTAMIENTO DE VILLARRIBA'),
    item(260, 720, '>>'),
    item(300, 720, '345,00  EUR'),
    item(520, 720, '>>'),
    item(560, 720, 'EMPRESA EJEMPLO SL'),
    item(20, 60, 'Refª Origen:   /   Nuestra Refª: 12345ABC678'
      + 'Fecha operación: 03-02-2025 / Fecha valor: 04-02-2025'),
  ];
}
```

Y el import ampliado al principio del fichero (añadir `parsearPaginaAuto` y,
si no estuvieran ya, `paginaMovimientos`/`item` desde los fixtures):

```js
import { parsearPaginaAuto } from '../src/parser.js';
import { paginaMovimientos } from './fixtures/molde.js';
```

- [ ] **Step 2: Verificar que fallan**

Run: `node --test test/*.test.js`
Expected: FAIL, `parsearPaginaAuto is not a function` (o `not defined`). Los 63 tests anteriores en PASS.

- [ ] **Step 3: Implementar el despachador**

Añadir al final de `src/parser.js`:

```js
/**
 * Punto de entrada unico para la interfaz. Recibe los fragmentos EN BRUTO
 * de una pagina (contenido.items de PDF.js), detecta el formato y despacha
 * al parser correspondiente. SIEMPRE devuelve arrays, tambien para el
 * formato transferencia (con 0 o 1 registro), para que quien lo llame no
 * tenga que distinguir "un registro" de "una lista de registros".
 *
 * parsearPagina (formato transferencia) no se modifica: conserva su firma
 * y comportamiento actuales. Este despachador solo le anade archivo/fila al
 * resultado, porque parsearPagina no conoce esos conceptos.
 */
export function parsearPaginaAuto(items, numeroPagina, archivo) {
  const utiles = (items || []).filter(it => it && it.str && it.str.trim());
  if (utiles.length === 0) {
    return {
      registros: [],
      anomalias: [{ pagina: numeroPagina, archivo, fila: null,
                    motivo: 'sin_texto', camposFaltantes: [] }],
    };
  }

  const formato = detectarFormato(utiles);

  if (formato === 'transferencia') {
    const lineas = agruparEnLineas(utiles);
    const { registro, anomalia } = parsearPagina(lineas, numeroPagina);
    return {
      registros: registro
        ? [{ ...registro, formato: 'transferencia', archivo, fila: null }] : [],
      anomalias: anomalia
        ? [{ ...anomalia, archivo, fila: null }] : [],
    };
  }

  if (formato === 'movimientos') {
    const tolerancia = tolerenciaAdaptativa(utiles);
    const lineas = agruparEnLineas(
      utiles, tolerancia !== null ? { tolerancia } : undefined);
    return parsearPaginaMovimientos(lineas, numeroPagina, archivo);
  }

  return {
    registros: [],
    anomalias: [{ pagina: numeroPagina, archivo, fila: null,
                  motivo: 'formato_no_reconocido', camposFaltantes: [] }],
  };
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `node --test test/*.test.js`
Expected: PASS, 67 tests (63 + 4 nuevos).

- [ ] **Step 5: Crear el generador de PDF sintético del formato 2**

Crear `test/fixtures/generar_pdf_prueba_movimientos.py`, siguiendo el mismo
patrón que `test/fixtures/generar_pdf_prueba.py` (construcción manual de un
PDF válido mínimo, sin dependencias) pero con la geometría medida del
formato 2: fuente pequeña (4,68pt) y cada fila repartida en dos
sub-alturas, para que el PDF sintético ejercite exactamente el problema que
motivó el diseño (si algún día `agruparEnLineas`/`tolerenciaAdaptativa`
cambian y dejan de recomponer las filas, este PDF real —generado, no
inventado a mano en JS— lo detectaría):

```python
#!/usr/bin/env python3
"""
Genera un PDF de prueba que reproduce el molde del listado de movimientos,
con datos COMPLETAMENTE INVENTADOS.

Reproduce la geometria real medida en el documento real: fuente pequena
(4.68pt) y cada fila repartida en dos sub-alturas de texto (salto ~3.6,
menor que la fuente), con las filas entre si separadas ~10.2 (mayor que la
fuente). Es lo que hace que, con la tolerancia por defecto de
agruparEnLineas, cada fila se parta en dos lineas -el problema que motivo
el diseno multiformato.

    python3 test/fixtures/generar_pdf_prueba_movimientos.py pdf-prueba-movimientos.pdf
"""

import sys

ANCHO, ALTO = 842, 595

# Cinco filas inventadas: con y sin Concepto, con coma interna en el
# ordenante, con importe negativo delante y detras, y con separador de
# miles.
FILAS = [
    {"fop": "10/01/2025", "fval": "11/01/2025",
     "desc": "Transferencia De Ayuntamiento De Villarriba, Concepto Servicio 123",
     "imp": "1.234,56"},
    {"fop": "12/01/2025", "fval": "13/01/2025",
     "desc": "Transferencia De Ayuntamiento De Villabajo",
     "imp": "345,00"},
    {"fop": "14/01/2025", "fval": "15/01/2025",
     "desc": "Transferencia De Empresa Ejemplo, S.L., Concepto Factura 9",
     "imp": "-50,00"},
    {"fop": "16/01/2025", "fval": "17/01/2025",
     "desc": "Comision mantenimiento cuenta",
     "imp": "75,00-"},
    {"fop": "18/01/2025", "fval": "19/01/2025",
     "desc": "Transferencia De Mancomunidad De Municipios, Concepto Recogida enero",
     "imp": "980,50"},
]


def escapar(t):
    return t.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def texto(x, y, t, tam=4.68):
    return f"BT /F1 {tam} Tf 1 0 0 1 {x} {y} Tm ({escapar(t)}) Tj ET\n"


def contenido():
    s = ""
    y = ALTO - 40
    s += texto(20, y, "Movimientos cuenta desde 01/01/2025 hasta 31/12/2025", tam=8)
    y -= 20
    s += texto(20, y, "Fecha Operacion", tam=6)
    s += texto(90, y, "Fecha Valor", tam=6)
    s += texto(160, y, "Concepto", tam=6)
    s += texto(600, y, "Importe", tam=6)
    y -= 20
    for f in FILAS:
        s += texto(20, y, f["fop"])
        s += texto(90, y, f["fval"])
        # La descripcion y el importe van a una sub-altura distinta de las
        # fechas (salto 3.6), reproduciendo la geometria real.
        y_desc = y - 3.6
        s += texto(160, y_desc, f["desc"])
        s += texto(600, y_desc, f["imp"])
        y -= 10.2
    return s


def construir():
    flujo = contenido().encode("cp1252", errors="replace")
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {ANCHO} {ALTO}] "
         f"/Resources << /Font << /F1 5 0 R >> >> "
         f"/Contents 4 0 R >>").encode("latin-1"),
        b"<< /Length " + str(len(flujo)).encode() + b" >>\nstream\n"
        + flujo + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
        b"/Encoding /WinAnsiEncoding >>",
    ]
    salida = bytearray(b"%PDF-1.4\n")
    desplazamientos = []
    for i, cuerpo in enumerate(objetos, start=1):
        desplazamientos.append(len(salida))
        salida += f"{i} 0 obj\n".encode() + cuerpo + b"\nendobj\n"
    inicio_xref = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n".encode()
    salida += b"0000000000 65535 f \n"
    for d in desplazamientos:
        salida += f"{d:010d} 00000 n \n".encode()
    salida += (f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\n"
               f"startxref\n{inicio_xref}\n%%EOF\n").encode()
    return bytes(salida)


if __name__ == "__main__":
    destino = sys.argv[1] if len(sys.argv) > 1 else "pdf-prueba-movimientos.pdf"
    datos = construir()
    with open(destino, "wb") as f:
        f.write(datos)
    print(f"{destino}: {len(FILAS)} filas, {len(datos)} bytes")
```

- [ ] **Step 6: Crear el extractor de items para el fixture de integración**

Crear `test/fixtures/extraer_items_movimientos.py`, igual que
`test/fixtures/extraer_items.py` (misma técnica: leer las posiciones
directamente del flujo de contenido, porque `pypdf` con `visitor_text`
devuelve la matriz a ceros en fragmentos que continúan línea):

```python
#!/usr/bin/env python3
"""
Extrae de pdf-prueba-movimientos.pdf los fragmentos de texto con sus
coordenadas, en la misma forma que los entrega PDF.js, y los vuelca a
items-pdf-prueba-movimientos.json.

    python3 test/fixtures/generar_pdf_prueba_movimientos.py pdf-prueba-movimientos.pdf
    python3 test/fixtures/extraer_items_movimientos.py pdf-prueba-movimientos.pdf
"""

import json
import re
import sys
from pypdf import PdfReader

RE = re.compile(
    rb'/F1 ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*?)\) Tj', re.S)


def extraer(ruta):
    paginas = []
    for pag in PdfReader(ruta).pages:
        items = []
        for tam, x, y, txt in RE.findall(pag.get_contents().get_data()):
            texto = txt.replace(b'\\(', b'(').replace(b'\\)', b')')
            fs = float(tam)
            items.append({
                "str": texto.decode('cp1252'),
                "transform": [fs, 0, 0, fs, float(x), float(y)],
                "height": fs,
            })
        paginas.append(items)
    return paginas


if __name__ == "__main__":
    origen = sys.argv[1] if len(sys.argv) > 1 else "pdf-prueba-movimientos.pdf"
    destino = "test/fixtures/items-pdf-prueba-movimientos.json"
    paginas = extraer(origen)
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(paginas, f, ensure_ascii=False, indent=1)
    print(f"{destino}: {len(paginas)} paginas, "
          f"{[len(p) for p in paginas]} fragmentos")
```

- [ ] **Step 7: Generar el fixture**

```bash
python3 test/fixtures/generar_pdf_prueba_movimientos.py pdf-prueba-movimientos.pdf
python3 test/fixtures/extraer_items_movimientos.py pdf-prueba-movimientos.pdf
rm pdf-prueba-movimientos.pdf   # NO se versiona; ya cubierto por *.pdf en .gitignore
```

El JSON resultante (`test/fixtures/items-pdf-prueba-movimientos.json`) SÍ se
versiona: es dato sintético inventado, igual que
`items-pdf-prueba.json` del formato 1.

- [ ] **Step 8: Escribir la prueba de integración**

Crear `test/integracion-movimientos.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsearPaginaAuto } from '../src/parser.js';

const paginas = JSON.parse(readFileSync(
  new URL('./fixtures/items-pdf-prueba-movimientos.json', import.meta.url)));

test('integracion movimientos: recorrido completo desde un PDF real hasta los registros', () => {
  assert.equal(paginas.length, 1);
  const { registros, anomalias } = parsearPaginaAuto(paginas[0], 1, 'prueba.pdf');

  assert.equal(anomalias.length, 0, 'ninguna fila deberia dar anomalia');
  assert.equal(registros.length, 5);

  assert.equal(registros[0].ordenante, 'Ayuntamiento De Villarriba');
  assert.equal(registros[0].concepto, 'Servicio 123');
  assert.equal(registros[0].importe, 1234.56);
  assert.equal(registros[0].fechaOperacion, '2025-01-10');
  assert.equal(registros[0].fechaValor, '2025-01-11');

  assert.equal(registros[1].ordenante, 'Ayuntamiento De Villabajo');
  assert.equal(registros[1].concepto, null); // sin "Concepto" en el molde

  assert.equal(registros[2].ordenante, 'Empresa Ejemplo, S.L.'); // coma interna
  assert.equal(registros[2].concepto, 'Factura 9');
  assert.equal(registros[2].importe, -50); // signo delante

  assert.equal(registros[3].ordenante, null); // sin "De", va todo a concepto
  assert.equal(registros[3].concepto, 'Comision mantenimiento cuenta');
  assert.equal(registros[3].importe, -75); // signo detras

  assert.equal(registros[4].importe, 980.5);

  for (const r of registros) {
    assert.equal(r.formato, 'movimientos');
    assert.equal(r.archivo, 'prueba.pdf');
    assert.equal(r.fechaEnvio, null);
  }
  assert.deepEqual(registros.map(r => r.fila), [1, 2, 3, 4, 5]);
});
```

- [ ] **Step 9: Verificar que pasa**

Run: `node --test test/*.test.js`
Expected: PASS, 68 tests (67 + 1 nuevo).

- [ ] **Step 10: Verificación por mutación (opcional pero recomendada)**

Para confirmar que la prueba de integración detecta de verdad una
regresión: comenta temporalmente la línea `if (ordenante) { reg.ordenante
= ordenante; ... }` dentro de `extraerOrdenanteConcepto`'s caller en
`parsearFilaMovimiento`, ejecuta `node --test
test/integracion-movimientos.test.js` (debe fallar), y deshaz el cambio.

- [ ] **Step 11: Commit**

```bash
node build.js
git add src/parser.js test/parser.test.js test/parser-movimientos.test.js \
        test/integracion-movimientos.test.js \
        test/fixtures/generar_pdf_prueba_movimientos.py \
        test/fixtures/extraer_items_movimientos.py \
        test/fixtures/items-pdf-prueba-movimientos.json buscador.html
git commit -m "$(cat <<'EOF'
Anadir el despachador parsearPaginaAuto y su prueba de integracion

parsearPaginaAuto es el punto de entrada unico: detecta el formato de la
pagina a partir de sus fragmentos en bruto y reparte al parser adecuado,
siempre devolviendo arrays. parsearPagina (formato transferencia) no se
modifica, solo se envuelve.

La prueba de integracion recorre el camino completo desde un PDF sintetico
real (generado con la geometria medida del documento real) hasta los
registros, cubriendo fila sin concepto, ordenante con coma interna,
importe negativo en ambas convenciones y fila sin estructura reconocible.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 5: Carga múltiple en la interfaz y exportación consciente de varios archivos

Se fusionan en una sola tarea porque no son revisables por separado: cambiar
la forma de `APP` (quitar `datosPdf`/`documentoPdf` singulares) deja
`exportarPdfFiltrado`/`generarPdfVisual` referenciando propiedades que ya no
existen hasta que también se actualizan. Un revisor de la primera mitad sola
marcaría eso como un defecto — no lo es, es una tarea a medio escribir.

**Files:**
- Modify: `src/ui.js:5-14` (`APP`), `:121-164` (`pintarInicio`), `:171-211`
  (`extraerTodo`), `:233-281` (`procesar`), `:436-438` (`paginasDeFilas`),
  `:456-486` (`generarPdfVisual`), `:493-551` (`exportarPdfFiltrado`),
  `:569-582` (`botonOtroPdf`)

**Interfaces:**
- Consumes: `parsearPaginaAuto` (Task 4)
- Produces: `procesarArchivos(archivos, estado, barra)`,
  `APP.documentosPorArchivo`, `paginasPorArchivo(filas)`,
  `botonVaciarTodo()` — todo lo que la Task 6 (columnas y pantalla de
  resultados) necesita

- [ ] **Step 1: Cambiar `APP` y la zona de carga para aceptar varios ficheros**

En `src/ui.js`, sustituir `pintarInicio` (líneas 121-164) por:

```js
function pintarInicio() {
  const app = document.getElementById('app');
  app.textContent = '';

  if (typeof pdfjsLib === 'undefined') {
    app.append(el('p', {
      className: 'aviso',
      textContent: 'No se pudo cargar el motor de PDF. Si has abierto el '
        + 'archivo directamente y tu navegador lo bloquea, sirve la carpeta '
        + 'con: python3 -m http.server, y abre http://localhost:8000/buscador.html',
    }));
    return;
  }

  app.append(
    el('h1', { textContent: 'Buscador de transferencias' }),
    el('p', {
      className: 'sub',
      textContent: 'El PDF se procesa en tu equipo. No se envía a ningún '
        + 'sitio. Admite orden de transferencia y listado de movimientos, '
        + 'y puedes soltar varios PDF a la vez.',
    }),
  );

  const entrada = el('input', { type: 'file', accept: 'application/pdf',
                                multiple: true, className: 'oculto' });
  const zona = el('div', { className: 'zona',
    textContent: 'Arrastra uno o varios PDF aquí, o haz clic para elegirlos' });
  const estado = el('p', { className: 'sub' });
  const barra = el('div', { className: 'barra oculto' }, [el('i')]);

  zona.addEventListener('click', () => entrada.click());
  zona.addEventListener('dragover', e => {
    e.preventDefault(); zona.classList.add('encima');
  });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.classList.remove('encima');
    const archivos = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf'
      || f.name.toLowerCase().endsWith('.pdf'));
    if (archivos.length) procesarArchivos(archivos, estado, barra);
  });
  entrada.addEventListener('change', e => {
    if (e.target.files.length) procesarArchivos([...e.target.files], estado, barra);
  });

  app.append(zona, entrada, barra, estado);
}
```

- [ ] **Step 2: Sustituir `extraerTodo` por una versión consciente de archivo, y añadir `procesarArchivos`**

Sustituir `extraerTodo` (líneas 171-211) por:

```js
/**
 * Extrae todos los registros y anomalias de UN documento ya abierto, en
 * lotes, cediendo el hilo entre lotes para que la barra de progreso avance
 * y la interfaz no se congele con documentos largos.
 */
async function extraerDeDocumento(doc, archivo, alProgresar) {
  const registros = [], anomalias = [];
  for (let inicio = 1; inicio <= doc.numPages; inicio += TAM_LOTE) {
    const fin = Math.min(inicio + TAM_LOTE - 1, doc.numPages);
    for (let n = inicio; n <= fin; n++) {
      let pagina = null;
      try {
        pagina = await doc.getPage(n);
        const contenido = await pagina.getTextContent();
        const { registros: regsPagina, anomalias: anomsPagina } =
          parsearPaginaAuto(contenido.items, n, archivo);
        registros.push(...regsPagina);
        anomalias.push(...anomsPagina);
      } catch (err) {
        anomalias.push({ pagina: n, archivo, fila: null, motivo: 'error_parser',
                         camposFaltantes: [], detalle: err.message });
        // Igual que en el formato de transferencia: error_parser NO borra
        // la fila. Aqui, sin saber cuantos registros tendria esa pagina, se
        // anade un unico registro minimo que la represente en la tabla.
        registros.push({
          pagina: n, archivo, formato: null, fila: null,
          ordenante: null, ordenanteBusqueda: '',
          importe: null, importeTexto: null, moneda: null,
          concepto: null, conceptoBusqueda: '',
          fechaOperacion: null, fechaOperacionTexto: null,
          fechaValor: null, fechaValorTexto: null,
          fechaEnvio: null, fechaEnvioTexto: null,
          extra: {},
        });
      } finally {
        if (pagina) pagina.cleanup();
      }
    }
    alProgresar(fin, doc.numPages);
    await respirar();
  }
  return { registros, anomalias };
}
```

Sustituir `procesar` (líneas 233-281) por `procesarArchivos`, que recorre
varios ficheros **en serie**, acumulando sobre `APP.registros`/`APP.anomalias`:

```js
/**
 * Procesa varios archivos EN SERIE (no en paralelo, para no complicar la
 * memoria ni el progreso) y acumula sus registros y anomalias sobre lo que
 * ya hubiera cargado. Cada archivo abre su propio documento PDF.js y queda
 * registrado en APP.documentosPorArchivo (Task 5), para poder exportar a
 * PDF sabiendo de que archivo viene cada pagina.
 */
async function procesarArchivos(archivos, estado, barra) {
  barra.classList.remove('oculto');
  let huboExito = false;
  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const prefijo = archivos.length > 1
      ? `Archivo ${i + 1} de ${archivos.length} (${archivo.name}): ` : '';
    estado.textContent = prefijo + 'Abriendo el PDF...';
    estado.className = 'sub';
    try {
      const datos = new Uint8Array(await archivo.arrayBuffer());
      const doc = await abrirDocumento(datos.slice());
      APP.documentosPorArchivo.set(archivo.name, { datosPdf: datos, documentoPdf: doc });
      const { registros, anomalias } = await extraerDeDocumento(doc, archivo.name,
        (hechas, total) => {
          estado.textContent = `${prefijo}Página ${hechas} de ${total}`;
          barra.firstChild.style.width = (hechas / total * 100) + '%';
        });
      APP.registros.push(...registros);
      APP.anomalias.push(...anomalias);
      huboExito = true;
    } catch (err) {
      estado.className = 'sub aviso';
      const nombre = err && err.name;
      if (nombre === 'PasswordException') {
        estado.textContent = `${prefijo}PDF protegido: no se introdujo la contraseña.`;
      } else if (nombre === 'InvalidPDFException') {
        estado.textContent = `${prefijo}Ese archivo no parece un PDF válido.`;
      } else {
        // No se interpola err.message: ver el comentario de abrirDocumento.
        estado.textContent = `${prefijo}No se pudo procesar este PDF. `
          + 'Puede estar dañado o tener un formato que la herramienta no '
          + `reconoce. (${nombre || 'error desconocido'}) Si el problema `
          + 'persiste, puede deberse a que el navegador bloquea el arranque '
          + 'del motor de PDF al abrir el archivo directamente: prueba a '
          + 'servir la carpeta con python3 -m http.server, y abre '
          + 'http://localhost:8000/buscador.html';
      }
      // Un archivo que falla no aborta el resto de la cola.
      if (i < archivos.length - 1) continue;
    }
  }
  barra.classList.add('oculto');
  if (huboExito) pintarResultados();
}
```

`APP.nombreArchivo` (singular) queda obsoleto — se sustituye por derivarlo
de `APP.registros`/`APP.documentosPorArchivo` en `pintarResultados` (Task
7). No lo borres todavía si otra parte del fichero lo usa; Task 7 termina
de limpiarlo.

- [ ] **Step 3: Actualizar `APP`**

Sustituir las líneas 5-14 de `src/ui.js`:

```js
const APP = {
  registros: [], anomalias: [],
  // Un documento PDF.js y sus bytes originales, por archivo cargado. Hace
  // falta saber de que archivo viene cada pagina para exportar a PDF: cada
  // fila puede pertenecer a un archivo distinto (Task 5).
  documentosPorArchivo: new Map(),
};
```


- [ ] **Step 4: Sustituir `paginasDeFilas` por `paginasPorArchivo`**

Sustituir en `src/ui.js` (líneas 436-438):

```js
/**
 * Agrupa las paginas por archivo, conservando el orden en que aparecen en
 * `filas` (el mismo criterio que antes usaba paginasDeFilas, aplicado ahora
 * por archivo en vez de globalmente: dos archivos distintos pueden tener
 * ambos una "pagina 3", y no son la misma pagina).
 */
function paginasPorArchivo(filas) {
  const mapa = new Map();
  for (const r of filas) {
    if (!mapa.has(r.archivo)) mapa.set(r.archivo, []);
    const paginas = mapa.get(r.archivo);
    if (!paginas.includes(r.pagina)) paginas.push(r.pagina);
  }
  return mapa;
}
```

- [ ] **Step 5: Actualizar `generarPdfVisual` para recorrer varios archivos**

Sustituir (líneas 456-486):

```js
/**
 * Alternativa para PDF cifrados o con una estructura que pdf-lib no admite.
 * PDF.js ya los ha abierto localmente: se dibujan sus paginas seleccionadas
 * en buena resolucion y se empaquetan de nuevo. El resultado es visual (no
 * conserva el texto seleccionable), pero contiene exactamente las paginas
 * solicitadas y no sale nunca del navegador. Recorre los archivos uno a
 * uno, en el orden en que aparecen en la tabla filtrada.
 */
async function generarPdfVisual(filas, alProgresar) {
  const salida = await PDFLib.PDFDocument.create();
  const canvas = document.createElement('canvas');
  const contexto = canvas.getContext('2d', { alpha: false });
  if (!contexto) throw new Error('No se pudo crear el lienzo.');
  const porArchivo = paginasPorArchivo(filas);
  const totalPaginas = [...porArchivo.values()].reduce((n, ps) => n + ps.length, 0);
  let hechas = 0;

  for (const [archivo, numeros] of porArchivo) {
    const doc = APP.documentosPorArchivo.get(archivo)?.documentoPdf;
    if (!doc) throw new Error(`Documento no disponible: ${archivo}`);
    for (const numero of numeros) {
      const pagina = await doc.getPage(numero);
      try {
        const tamanoPdf = pagina.getViewport({ scale: 1 });
        const tamanoRender = pagina.getViewport({ scale: 1.5 });
        canvas.width = Math.ceil(tamanoRender.width);
        canvas.height = Math.ceil(tamanoRender.height);
        contexto.fillStyle = '#fff';
        contexto.fillRect(0, 0, canvas.width, canvas.height);
        await pagina.render({ canvasContext: contexto, viewport: tamanoRender }).promise;
        const imagen = await salida.embedJpg(await (await blobDeCanvas(canvas)).arrayBuffer());
        const destino = salida.addPage([tamanoPdf.width, tamanoPdf.height]);
        destino.drawImage(imagen, {
          x: 0, y: 0, width: tamanoPdf.width, height: tamanoPdf.height,
        });
      } finally {
        pagina.cleanup();
      }
      hechas++;
      alProgresar(hechas, totalPaginas);
      await respirar();
    }
  }
  return salida.save();
}
```

- [ ] **Step 6: Actualizar `exportarPdfFiltrado`**

Sustituir (líneas 493-551):

```js
/**
 * Copia las paginas filtradas sin rasterizarlas, archivo por archivo. Si
 * la copia directa no es posible para alguno (por ejemplo por su cifrado),
 * usa una copia visual como respaldo PARA TODO el resultado: mezclar
 * paginas copiadas directamente con paginas rasterizadas en el mismo PDF de
 * salida no aporta nada y complica el codigo sin necesidad.
 */
async function exportarPdfFiltrado(filas, boton) {
  if (typeof PDFLib === 'undefined' || filas.length === 0) {
    alert(filas.length === 0
      ? 'No hay resultados filtrados para exportar.'
      : 'No se pudo preparar el PDF para exportar. Vuelve a cargar el archivo.');
    return;
  }
  const porArchivo = paginasPorArchivo(filas);
  for (const archivo of porArchivo.keys()) {
    if (!APP.documentosPorArchivo.has(archivo)) {
      alert(`No se pudo preparar el PDF para exportar: falta el archivo `
        + `original de "${archivo}". Vuelve a cargarlo.`);
      return;
    }
  }

  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Preparando PDF…';
  let errorCopiaDirecta = null;
  try {
    let contenido;
    let copiaVisual = false;
    try {
      const salida = await PDFLib.PDFDocument.create();
      for (const [archivo, numeros] of porArchivo) {
        const { datosPdf } = APP.documentosPorArchivo.get(archivo);
        const origen = await PDFLib.PDFDocument.load(datosPdf);
        const paginas = await salida.copyPages(origen, numeros.map(n => n - 1));
        paginas.forEach(pagina => salida.addPage(pagina));
      }
      contenido = await salida.save();
    } catch (error) {
      errorCopiaDirecta = error;
      copiaVisual = true;
      boton.textContent = 'Preparando copia visual…';
      contenido = await generarPdfVisual(filas, (hechas, total) => {
        boton.textContent = `Preparando PDF ${hechas}/${total}…`;
      });
    }
    const nombre = porArchivo.size === 1
      ? `${[...porArchivo.keys()][0].replace(/\.pdf$/i, '')}-filtrado.pdf`
      : 'buscador-filtrado.pdf';
    descargar(nombre, contenido, 'application/pdf');
    if (copiaVisual) {
      alert('Se ha exportado una copia visual porque algún PDF original no '
        + 'permitía copiar sus páginas directamente.');
    }
  } catch (error) {
    // Los mensajes de las bibliotecas pueden contener metadatos del extracto.
    // Solo se muestra el nombre de la clase de error.
    const nombre = error && error.name ? error.name : 'error desconocido';
    const directa = errorCopiaDirecta && errorCopiaDirecta.name
      ? ` La copia directa falló con ${errorCopiaDirecta.name}.` : '';
    const referencia = nombre === 'ReferenceError' && error.message
      ? ` Falta: ${error.message}.` : '';
    alert(`No se pudo crear la copia visual del PDF (${nombre}).${referencia}`
      + directa);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}
```

- [ ] **Step 7: Actualizar `botonOtroPdf` — se convierte en "Vaciar todo"**

Sustituir (líneas 569-582). Esta tarea separa **añadir** (ya cubierto por
volver a soltar archivos sobre la pantalla de resultados, Task 7) de
**vaciar** (destructivo, botón propio):

```js
/** Boton para descartar todo lo cargado y volver a la pantalla inicial. */
function botonVaciarTodo() {
  const boton = el('button', { textContent: 'Vaciar todo' });
  boton.addEventListener('click', () => {
    clearTimeout(temporizadorFiltro);
    APP.registros = []; APP.anomalias = []; APP.criterios = {};
    for (const { documentoPdf } of APP.documentosPorArchivo.values()) {
      documentoPdf.destroy();
    }
    APP.documentosPorArchivo = new Map();
    APP.orden = { clave: 'pagina', ascendente: true };
    pintarInicio();
  });
  return boton;
}
```

- [ ] **Step 8: Verificación conjunta de toda la tarea**

```bash
node --test test/*.test.js   # deben seguir en 68/68: esta tarea no toca parser.js
node build.js
grep -c "APP.datosPdf\|APP.documentoPdf\b" src/ui.js   # debe dar 0: ya no existen esas propiedades
grep -c "botonOtroPdf\b" src/ui.js                     # debe dar 0: se sustituyo por completo
```

Expected: `tests 68`, `pass 68`, `fail 0`; `buscador.html generado (...
KB)`; ambos `grep` dan 0. Si el `grep` de `botonOtroPdf` da más de 0, queda
alguna referencia sin actualizar — corregirla antes de seguir; la Task 6
(la siguiente) usará `botonVaciarTodo` en su lugar.

- [ ] **Step 9: Commit**

```bash
git add src/ui.js buscador.html
git commit -m "$(cat <<'EOF'
Carga multiple de PDF y exportacion consciente de varios archivos

APP pasa de un archivo (nombreArchivo/datosPdf/documentoPdf singulares) a
varios: documentosPorArchivo (Map por archivo) y registros/anomalias
acumulativos entre cargas. procesarArchivos sustituye a procesar: recorre
los archivos en serie, cada uno con su propio progreso (Archivo N de M),
sin descartar lo ya cargado.

paginasPorArchivo agrupa las paginas filtradas por archivo, conservando
el orden de la tabla; exportarPdfFiltrado y generarPdfVisual recorren ese
mapa archivo por archivo y concatenan el resultado en un unico PDF de
salida. botonOtroPdf se sustituye por botonVaciarTodo: con la carga
acumulativa, "cargar otro" y "empezar de cero" son acciones distintas y
la segunda es destructiva.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 6: Columnas nuevas, panel de anomalías con archivo/fila, aviso de truncado, pantalla de resultados

Esta tarea termina de conectar `pintarResultados` y `panelAnomalias` con
todo lo construido en la Task 5, y añade lo que falta de la interfaz:
columna Archivo, botón para añadir más PDF sin perder lo cargado, y el
aviso del concepto truncado.

**Files:**
- Modify: `src/ui.js` — `COLUMNAS` (cabecera del fichero), `pintarResultados`
  y `panelAnomalias` (las líneas exactas habrán cambiado tras la Task 5;
  localízalas por nombre de función, no por número de línea)

**Interfaces:**
- Consumes: `procesarArchivos`, `botonVaciarTodo`, `paginasPorArchivo` (Task 5)
- Produces: pantalla de resultados funcional con carga múltiple

- [ ] **Step 1: Añadir las columnas nuevas**

Sustituir en `src/ui.js` (líneas 16-24, el array `COLUMNAS` base — se le
añade `archivo` como visible, y se deja `pagina` donde está):

```js
const COLUMNAS = [
  { clave: 'archivo', titulo: 'Archivo', tipo: 'texto', visible: true },
  { clave: 'pagina', titulo: 'Pág.', tipo: 'num', visible: true },
  { clave: 'ordenante', titulo: 'Ordenante', tipo: 'texto', visible: true },
  { clave: 'importe', titulo: 'Importe', tipo: 'importe', visible: true },
  { clave: 'concepto', titulo: 'Concepto', tipo: 'texto', visible: true },
  { clave: 'fechaOperacion', titulo: 'F. operación', tipo: 'fecha', visible: true },
  { clave: 'fechaValor', titulo: 'F. valor', tipo: 'fecha', visible: true },
  { clave: 'fechaEnvio', titulo: 'F. envío', tipo: 'fecha', visible: true },
];
```

Y añadir a la lista de columnas ocultas (dentro del `COLUMNAS.push(...)`
existente, líneas 26-41 — añadir estas dos entradas, sin tocar las que ya
había):

```js
  { clave: 'formato', titulo: 'Formato', tipo: 'texto', visible: false, extra: false },
  { clave: 'fila', titulo: 'Fila', tipo: 'num', visible: false, extra: false },
```

(`extra: false` porque `formato`/`fila` viven directamente en el registro,
no dentro de `registro.extra` — `valorColumna` ya distingue esto por la
presencia de la clave `extra` en la definición de columna.)

- [ ] **Step 2: Sustituir `pintarResultados`**

Sustituir (líneas 584-634). Añade el aviso del concepto truncado (solo
cuando hay registros del formato movimientos) y el botón para añadir más
PDF junto al de vaciar:

```js
function pintarResultados() {
  const app = document.getElementById('app');
  app.textContent = '';

  if (APP.registros.length === 0) {
    app.append(
      el('h1', { textContent: 'Buscador de transferencias' }),
      el('p', { className: 'aviso',
        textContent: 'Ninguna página encajó en ningún formato conocido. '
          + 'Puede que este PDF tenga otro formato, o que sea un escaneo '
          + 'sin capa de texto.' }),
      botonAnadirMas(),
      botonVaciarTodo(),
      panelAnomalias(),
    );
    return;
  }

  const exportar = el('button', { textContent: 'Exportar CSV' });
  exportar.addEventListener('click', () => {
    const visibles = columnasVisibles();
    if (visibles.length === 0) {
      alert('No hay ninguna columna seleccionada. Activa al menos una en '
        + '«Columnas» para exportar.');
      return;
    }
    const archivos = [...new Set(APP.filas.map(r => r.archivo))];
    const nombre = archivos.length === 1
      ? `${archivos[0].replace(/\.pdf$/i, '')}-filtrado.csv`
      : 'buscador-filtrado.csv';
    descargar(nombre, generarCsv(APP.filas, visibles), 'text/csv;charset=utf-8');
  });

  const exportarPdf = el('button', { textContent: 'Exportar PDF' });
  exportarPdf.addEventListener('click', () => {
    exportarPdfFiltrado(APP.filas, exportarPdf);
  });

  const archivosCargados = new Set(APP.registros.map(r => r.archivo));
  const hayMovimientos = APP.registros.some(r => r.formato === 'movimientos');

  const cabecera = [
    el('h1', { textContent: 'Buscador de transferencias' }),
    el('p', { className: 'sub',
      textContent: `${APP.registros.length} transferencias de `
        + `${archivosCargados.size} ${archivosCargados.size === 1 ? 'archivo' : 'archivos'}` }),
  ];
  if (hayMovimientos) {
    cabecera.push(el('p', { className: 'sub aviso',
      textContent: 'Aviso: en el listado de movimientos, el concepto puede '
        + 'venir truncado en el propio PDF. Si buscas una palabra que '
        + 'estuviera al final de un concepto largo, esa fila podría no '
        + 'aparecer.' }));
  }

  app.append(
    ...cabecera,
    botonAnadirMas(),
    botonVaciarTodo(),
    panelAnomalias(),
    pintarFiltros(refrescar),
    pintarColumnas(),
    el('p', { id: 'contador', className: 'sub' }),
    exportar,
    exportarPdf,
    el('div', { id: 'tabla' }),
  );
  refrescar();
}

/** Boton para anadir mas PDF sin perder lo ya cargado: reutiliza la misma
 * zona de arrastre/seleccion multiple que la pantalla inicial. */
function botonAnadirMas() {
  const entrada = el('input', { type: 'file', accept: 'application/pdf',
                                multiple: true, className: 'oculto' });
  const boton = el('button', { textContent: 'Añadir más PDF' });
  const estado = el('span', { className: 'sub' });
  const barra = el('div', { className: 'barra oculto' }, [el('i')]);
  boton.addEventListener('click', () => entrada.click());
  entrada.addEventListener('change', async e => {
    if (!e.target.files.length) return;
    await procesarArchivos([...e.target.files], estado, barra);
  });
  return el('span', {}, [boton, entrada, barra, estado]);
}
```

- [ ] **Step 3: Sustituir `panelAnomalias`**

Sustituir (líneas 636-667), para que muestre archivo y fila:

```js
function panelAnomalias() {
  const cont = el('div');
  if (APP.anomalias.length === 0) {
    cont.append(el('p', { className: 'sub',
      textContent: 'Todas las páginas encajaron en algún formato conocido.' }));
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
    textContent: `${APP.anomalias.length} avisos (${resumen})` }));
  const lista = el('ul');
  for (const a of APP.anomalias.slice(0, 200)) {
    const campos = a.camposFaltantes.length
      ? ` — falta: ${a.camposFaltantes.join(', ')}` : '';
    const fila = a.fila ? `, fila ${a.fila}` : '';
    lista.append(el('li', {
      textContent: `${a.archivo}, página ${a.pagina}${fila}: ${a.motivo}${campos}`,
    }));
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

- [ ] **Step 4: Actualizar la llamada a `pintarResultados` en `procesarArchivos`**

En `procesarArchivos` (Task 5), la llamada ya es `pintarResultados()` sin
argumento (el parámetro `segundos` se retiró porque ahora hay varios
archivos con tiempos distintos). Confirma que no queda ninguna llamada con
argumento:

```bash
grep -n "pintarResultados(" src/ui.js
```

Expected: todas las llamadas son `pintarResultados()`, sin argumento.

- [ ] **Step 5: Verificar manualmente en un navegador**

```bash
python3 test/fixtures/generar_pdf_prueba.py /tmp/prueba1.pdf
python3 test/fixtures/generar_pdf_prueba_movimientos.py /tmp/prueba2.pdf
node build.js
python3 -m http.server 8731 --directory . &
```

Abre `http://localhost:8731/buscador.html`, suelta `/tmp/prueba1.pdf` y
`/tmp/prueba2.pdf` **a la vez** (selección múltiple). Comprueba:
- aparecen registros de ambos formatos en la misma tabla,
- la columna Archivo distingue el origen de cada fila,
- el aviso de concepto truncado aparece (hay registros de movimientos),
- "Añadir más PDF" con `/tmp/prueba1.pdf` de nuevo **añade** filas en vez de sustituir,
- "Vaciar todo" vuelve a la pantalla inicial vacía,
- "Exportar CSV" y "Exportar PDF" funcionan con ambos archivos cargados.

Detén el servidor: `kill %1`.

- [ ] **Step 6: Commit**

```bash
node build.js
git add src/ui.js buscador.html
git commit -m "$(cat <<'EOF'
Columna Archivo, panel de anomalias con archivo/fila, anadir mas PDF

pintarResultados y panelAnomalias quedan conectados a la carga multiple:
cabecera con el numero de archivos, aviso de concepto truncado cuando hay
registros del formato movimientos, boton para anadir mas PDF sin perder
lo cargado (junto al de vaciar todo, separados porque uno es destructivo
y el otro no).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 7: `sondear_pdfjs.cjs` — el sondeo con el motor que usa la herramienta

Existe para no repetir el error que motivó todo este trabajo: el diseño
original se hizo leyendo un sondeo generado con pypdf, que no ve lo mismo
que PDF.js (el motor real de la herramienta). Esta tarea deja un sondeo que
sí usa PDF.js, para la próxima vez que aparezca un formato nuevo.

**Files:**
- Create: `sondear_pdfjs.cjs`

**Interfaces:**
- Consumes: `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` (ya vendorizados)
- Produces: script de línea de comandos, sin tests (es una herramienta de
  diagnóstico manual, como `sondeo_estructura.py`, no código de producción)

- [ ] **Step 1: Escribir el script**

Crear `sondear_pdfjs.cjs`:

```js
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
```

- [ ] **Step 2: Prueba de humo contra el PDF sintético (nunca contra un real)**

```bash
python3 test/fixtures/generar_pdf_prueba_movimientos.py /tmp/prueba-sondeo.pdf
node sondear_pdfjs.cjs /tmp/prueba-sondeo.pdf --modo linea
rm /tmp/prueba-sondeo.pdf
```

Expected: termina sin error, sección 1 confirma "muchas líneas por página"
(el fixture tiene 5 filas en una sola página con fuente pequeña), sección 2
lista un vocabulario corto y con sentido (`ayuntamiento`, `concepto`,
`transferencia`, `de`...), sección 3 muestra el molde enmascarado.

- [ ] **Step 3: Commit**

```bash
git add sondear_pdfjs.cjs
git commit -m "$(cat <<'EOF'
Anadir sondear_pdfjs.cjs: el sondeo de estructura con PDF.js

sondeo_estructura.py usa pypdf, que no ve lo mismo que PDF.js -el motor
real de la herramienta-. Fue asi como paso desapercibido que un
documento tabular partia cada fila en dos lineas: el sondeo con pypdf no
lo mostraba. Mismo enmascarado por clase de caracter y misma norma de
revisar la salida antes de compartirla, pero con el motor correcto.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
```

---

### Task 8: README y verificación final con el PDF real

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: nada de código. Es la comprobación final, que hace el usuario.

- [ ] **Step 1: Actualizar el README**

Añade (o actualiza, si ya existe una sección similar) en `README.md`:
- Mención de los dos formatos admitidos (orden de transferencia, listado
  de movimientos) y que se detectan automáticamente.
- Que se pueden cargar varios PDF a la vez, de cualquiera de los dos
  formatos, y que se acumulan.
- La limitación del concepto truncado en el listado de movimientos.
- El comando para regenerar los fixtures del formato 2:
  ```
  python3 test/fixtures/generar_pdf_prueba_movimientos.py pdf-prueba-movimientos.pdf
  python3 test/fixtures/extraer_items_movimientos.py pdf-prueba-movimientos.pdf
  ```
- Actualiza el recuento de tests si el README lo menciona explícitamente.

No inventes contenido: si alguna sección ya cubre esto con otras palabras,
ajústala en vez de duplicarla.

- [ ] **Step 2: Ejecutar la batería completa**

```bash
node --test test/*.test.js
node build.js
git status --porcelain --ignored | grep '^!!'
```

Expected: todos los tests pasan (68 o más si el Step 1 no añadió tests);
`buscador.html` se genera; `TRANSFERENCIAS RECIBIDAS.pdf`,
`MovimientosCuenta ok.pdf` y `sondeo*.txt` siguen ignorados.

- [ ] **Step 3: Verificación con el PDF real — la hace el usuario**

Entregar estas instrucciones:

> Abre `buscador.html` con doble clic y arrastra `MovimientosCuenta
> ok.pdf`. Dime tres cosas: cuántas filas salieron, si el panel de
> anomalías está vacío o no (y si no, cuántas y de qué motivo), y si al
> arrastrar también `TRANSFERENCIAS RECIBIDAS.pdf` a continuación (con
> "Añadir más PDF") ambos aparecen mezclados en la misma tabla con la
> columna Archivo distinguiéndolos.

Si aparecen anomalías, **no seguir adelante inventando**: recoger los
motivos y los números de fila/página, reproducirlos como un caso nuevo en
`test/fixtures/molde.js` (`filaMovimientos`/`paginaMovimientos`) con datos
inventados que reproduzcan la misma forma, escribir el test que falla y
corregir el parser.

- [ ] **Step 4: Commit y push**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Documentar el soporte multiformato y la carga de varios PDF

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N9az68fnKvdieiAZGYWmSK
EOF
)"
git push origin main
```

---

## Notas para quien ejecute el plan

- **No abras `TRANSFERENCIAS RECIBIDAS.pdf` ni `MovimientosCuenta ok.pdf`.**
  Contienen datos personales. Todo lo necesario de su estructura está en
  este plan y en la spec. Si hace falta volver a analizar cualquiera de los
  dos, usa `sondeo_estructura.py` (con `--modo linea` para el segundo) y
  pide al usuario que revise la salida antes de mirarla.
- **No inventes fixtures a partir de un PDF real.** Los datos de prueba se
  inventan siempre.
- El camino del formato 1 (`parsearPagina`, sus 38 tests originales) **no
  se toca en ninguna tarea**. Si algo pareciera requerirlo, para y consulta
  antes de tocarlo: el PDF real de ese formato ya no está en el
  repositorio, y no hay forma de volver a comprobar un cambio contra él.
- Si una tarea revela que el molde del formato 2 asumido en la spec es
  incorrecto en algún punto no cubierto aquí, para y consulta en lugar de
  adaptar los tests hasta que pasen.
