# Soporte multiformato y carga de varios PDF — diseño

Fecha: 2026-09-16

Amplía el diseño original, `2026-09-07-buscador-transferencias-pdf-design.md`,
que sigue vigente en todo lo que este documento no contradice.

## Problema

La herramienta solo entiende un formato: la **orden de transferencia**, con
una transferencia por página y etiquetas fijas. Ha aparecido un segundo
formato, un **listado de movimientos de cuenta**, con decenas de filas por
página. Son documentos de naturaleza distinta, no una variante del mismo
molde.

Además, hoy se carga un PDF cada vez. En la práctica los extractos llegan
repartidos en varios ficheros (meses o cuentas distintas) y hace falta
buscar entre todos a la vez.

## Objetivo

Poder arrastrar **varios PDF a la vez, de cualquiera de los dos formatos**,
que la herramienta reconozca cada uno y vuelque todo a **una sola tabla**
filtrable, acumulando sobre lo ya cargado.

## Qué se verificó antes de diseñar

Estas medidas condicionan el diseño y se dejan escritas porque el primer
diseño, hecho sin ellas, era incorrecto.

**El sondeo y el producto no usan el mismo motor de extracción.** El sondeo
(`sondeo_estructura.py`) usa pypdf; la herramienta usa PDF.js. Sobre la
misma página:

| | pypdf | PDF.js |
|---|---|---|
| líneas | 53 | 104 |
| carácter más largo | 333 | 189 |

**Con PDF.js cada movimiento se parte en dos líneas.** De 270 líneas en 3
páginas: 134 empiezan por fecha, 134 terminan en importe, **0 tienen ambas
cosas**, 2 no son filas (título y cabecera).

**La causa está medida.** Fuente de 4,68 puntos. Los saltos verticales se
agrupan en dos valores: **3,6** (dentro de una misma fila) y **10,2** (entre
filas). La tolerancia de `agruparEnLineas` es `max(2, altura × 0,5)` = 2,34,
menor que 3,6, y por eso parte las filas.

**Tolerancias probadas** sobre el documento real:

| tolerancia | líneas | filas completas |
|---|---|---|
| 2,34 (actual) | 270 | 0 |
| 3,0 | 270 | 0 |
| **4,0 – 8,0** | **136** | **134** |
| 10,5 | 3 | 2 |

Hay una ventana amplia y segura entre 4 y 8.

**El concepto viene truncado en origen.** La descripción tiene un tope duro
de 202 caracteres y 12 de las 134 filas caen exactamente en él. No es un
problema de extracción: el texto no está en el PDF. Es una limitación
irreparable, y debe avisarse en la interfaz.

**El concepto es opcional.** 3 de las 134 filas no contienen la palabra
`Concepto`.

## Restricción que ordena el diseño

**El camino del formato 1 no se toca.** El PDF de transferencias real ya no
está en el directorio de trabajo, así que no hay forma de comprobar que un
cambio en el código compartido (`agruparEnLineas`, `normalizarImporte`) no lo
rompa. Todo lo que el formato 2 necesite de una función compartida se añade
como parámetro opcional cuyo valor por defecto conserva el comportamiento
actual.

## Estructura del formato 2

Molde de una fila, con datos inventados:

```
dd/mm/aaaa   dd/mm/aaaa   Transferencia De Ayuntamiento De Villarriba, Concepto Servicio n 12345.        1.234,56
└─ f. oper ┘ └─ f. valor ┘ └───────────── descripción ─────────────────────────────────────┘        └ importe ┘
```

- Una página arranca con una línea de título y una de cabecera de columnas;
  el resto son filas de datos.
- La cabecera **no se repite** en las páginas siguientes: aparece una sola
  vez, al principio del documento.
- No hay campos secundarios: ni IBAN, ni titular, ni entidad, ni
  beneficiario.
- **No hay fecha de envío.** Solo dos fechas por fila.
- No hay columna de saldo.

## Arquitectura

### Detección de formato

`detectarFormato(items)` recibe los **fragmentos en bruto** de PDF.js, no
líneas ya reconstruidas. Es deliberado: la reconstrucción de líneas necesita
una tolerancia que depende del formato, así que no puede preceder a la
detección.

1. Si el texto concatenado de los fragmentos contiene `ORDEN DE
   TRANSFERENCIA` → `'transferencia'`.
2. Si no, y hay al menos 3 fragmentos que empiezan por `dd/mm/aaaa` y al
   menos 3 que terminan en un importe → `'movimientos'`.
3. En otro caso → `null`.

El umbral de 3 evita clasificar como listado una página casi vacía. Una
página que no encaje en ninguno de los dos produce la anomalía
`formato_no_reconocido`, y no se pierde: aparece en el panel con su archivo
y su número de página.

**Comprobado** sobre los dos documentos disponibles: clasifica correctamente
las 3 páginas del PDF sintético del formato 1 y las 3 del documento real del
formato 2.

### Tolerancia por formato

`agruparEnLineas(items, opciones)` acepta `opciones.tolerancia`. Sin ese
parámetro se comporta **exactamente como hoy** (`max(2, altura × 0,5)`), que
es lo que usa el formato 1.

El formato 2 pasa una tolerancia **adaptativa**, calculada de la propia
página:

1. Se toman los saltos verticales entre coordenadas Y consecutivas distintas.
2. Se ordenan esos valores de menor a mayor y se busca **el mayor salto
   relativo entre dos consecutivos** — la frontera entre "saltos dentro de
   una fila" y "saltos entre filas". En el documento medido, esa frontera
   cae entre 3,6 y 10,2.
3. La tolerancia es el punto medio de esa frontera (aquí, 6,9: dentro de la
   ventana segura de 4 a 8).
4. Si la página tiene menos de 5 saltos distintos, no hay suficiente
   evidencia para separar dos grupos y se usa el valor por defecto.

Se prefiere la vía adaptativa a un multiplicador fijo porque se autoajusta a
extractos con otra fuente o interlineado, que es previsible que aparezcan.

### Despachador

```js
parsearPaginaAuto(items, numeroPagina, archivo)
  -> { registros: Registro[], anomalias: Anomalia[] }
```

Punto de entrada único de la interfaz. Detecta el formato, reconstruye las
líneas con la tolerancia adecuada y despacha. **Siempre devuelve arrays**,
también para el formato 1 (con 0 o 1 registro), para que la interfaz tenga
un solo camino.

`parsearPagina` (formato 1) se mantiene con su firma y su comportamiento
actuales, y sus 38 tests siguen valiendo sin tocarlos.

### Registro

El `Registro` actual gana tres campos:

| campo | formato 1 | formato 2 |
|---|---|---|
| `formato` | `'transferencia'` | `'movimientos'` |
| `archivo` | nombre del PDF | nombre del PDF |
| `fila` | `null` | número de fila dentro de la página (1..n) |

`fechaEnvio` queda `null` en el formato 2 y **no genera anomalía**: no es un
dato ausente, es un dato que ese tipo de documento no tiene.

## Reglas de extracción del formato 2

Para cada línea que empiece por `dd/mm/aaaa` y termine en un importe válido:

| campo | regla |
|---|---|
| `fechaOperacion` | primera fecha de la línea |
| `fechaValor` | segunda fecha de la línea |
| `importe` | último elemento separado por espacios, validado **entero** con `normalizarImporte` |
| `ordenante` | de la descripción (lo que queda tras las dos fechas y antes del importe): texto entre su **primer** ` De ` y la etiqueta `, Concepto`; si no hay `Concepto`, hasta el final de la descripción, quitando una coma final si la hubiera |
| `concepto` | texto tras `Concepto `; `null` si la etiqueta no aparece |

**El ordenante se corta por la etiqueta `, Concepto`, nunca por la primera
coma**: hay ordenantes que contienen comas (`Empresa Ejemplo, S.L.`) y
cortar por coma los truncaría.

**La detección de fila no se ancla en la palabra `Transferencia`.** Este
extracto son todo transferencias, pero un listado de movimientos puede traer
recibos, comisiones o adeudos. Si una fila no presenta la estructura
`De … Concepto`, la descripción entera va a `concepto` y `ordenante` queda
`null`.

### Campos del núcleo del formato 2

**Cuatro**, no seis: `fechaOperacion`, `fechaValor`, `ordenante`, `importe`.
`concepto` es opcional y su ausencia no genera anomalía, porque se ha
comprobado que hay filas legítimas sin él. `fechaEnvio` no aplica.

Como en el formato 1, una fila a la que le falte un campo del núcleo **entra
igualmente en la tabla** con ese campo vacío, y además se lista como
anomalía.

### Importes negativos

`normalizarImporte(texto, opciones)` acepta `opciones.permitirNegativo`. Sin
ese parámetro rechaza el signo, **igual que hoy**, que es lo que usa el
formato 1. El formato 2 lo activa, porque un listado de movimientos puede
traer cargos. Se aceptan el signo delante (`-1.234,56`) y detrás
(`1.234,56-`), que son las dos convenciones habituales en extractos.

## Carga de varios PDF

- El selector y la zona de arrastre aceptan **varios ficheros**.
- Se procesan **en serie**, no en paralelo, para no complicar la memoria ni
  el progreso.
- Progreso: `Archivo 2 de 3 (nombre.pdf): página 40 de 120`.
- Los resultados se **acumulan** sobre los ya cargados. El botón pasa a ser
  *Añadir más PDF*.
- Se añade un botón **Vaciar todo**, separado, porque descartar lo cargado
  es una acción destructiva y no debe compartir botón con añadir.
- Si el mismo fichero se carga dos veces, sus filas aparecen dos veces. No se
  deduplica: detectar duplicados entre extractos con rangos solapados es un
  problema distinto y no se aborda aquí.

### Columnas

- **Archivo**: visible por defecto. Con varios PDF cargados es información
  central para interpretar la tabla, no un detalle secundario.
- **Fila** y **Formato**: ocultas por defecto, disponibles en el selector,
  como el resto de campos secundarios.

## Anomalías

`Anomalia` gana `archivo` y `fila` (opcional). El panel las identifica como
*«extracto-marzo.pdf, página 2, fila 14: importe»*.

Sigue rigiendo la regla de confidencialidad: **solo nombre de archivo,
número de página, número de fila, motivo y nombres de campo. Nunca
contenido.**

Motivo nuevo: `formato_no_reconocido`, a nivel de página.

## Limitación que debe verse en la interfaz

Cuando se carguen documentos de formato 2, la interfaz avisará de que **el
concepto puede venir truncado en el propio PDF**, porque afecta a las
búsquedas: filtrar por una palabra que estaba al final de un concepto largo
no encontrará esas filas. Es un aviso informativo junto al recuento, no una
anomalía por fila.

## Pruebas

Mismo enfoque que el formato 1, y por el mismo motivo: ningún test toca un
documento real.

- `test/fixtures/generar_pdf_prueba_movimientos.py` genera un PDF sintético
  con datos inventados que reproduce el molde del formato 2, **incluida su
  geometría**: fuente pequeña, salto intra-fila menor que la altura de la
  fuente y salto entre filas mayor. Sin esa geometría el fixture no
  ejercitaría el problema que motivó el diseño.
- `test/parser-movimientos.test.js`: detección de formato, tolerancia
  adaptativa, extracción de los cuatro campos del núcleo, ordenante con coma
  interna, fila sin concepto, fila sin estructura `De … Concepto`, importe
  negativo con signo delante y detrás, y fila con un campo ilegible que debe
  producir registro **y** anomalía.
- Prueba de integración desde el PDF sintético, como la del formato 1.
- Los 38 tests existentes deben seguir pasando **sin modificarlos**. Si
  alguno falla, es señal de que se ha tocado el camino del formato 1.

## Mejora del sondeo

`sondeo_estructura.py` seguirá siendo útil para una primera lectura, pero el
diseño de un parser debe hacerse sobre lo que ve PDF.js. Se añade
`sondear_pdfjs.cjs`: mismo enmascarado por clase de carácter, misma norma de
revisar la salida antes de compartirla, pero extrayendo con PDF.js y con la
misma reconstrucción de líneas que usa la herramienta.

## Fuera de alcance

- Deduplicar movimientos entre ficheros solapados.
- Recuperar el texto truncado del concepto: no está en el PDF.
- Procesar varios PDF en paralelo.
- Un tercer formato.
- OCR.

## Trabajo pendiente que se arrastra

De la revisión final del proyecto anterior quedaron dos puntos sin aplicar,
y uno de ellos se resuelve aquí por cercanía:

- **Moneda no visible** (Importante): `parser.js` extrae `moneda`, pero no
  hay columna, así que un importe en divisa se lee como si fuera en euros.
  Se corrige en este trabajo, porque ya se están tocando las columnas.
- **Fixture incompleto** (Menor): `paginaMolde` no genera seis líneas que sí
  aparecen en todas las páginas reales del formato 1. Queda pendiente; no se
  aborda aquí para no tocar el camino del formato 1.

## Entregables

| Fichero | Cambio |
|---|---|
| `src/parser.js` | `detectarFormato`, `parsearPaginaMovimientos`, `parsearPaginaAuto`, tolerancia adaptativa, `permitirNegativo` |
| `src/ui.js` | carga múltiple, acumulación, progreso por archivo, columnas nuevas, aviso de truncado |
| `test/parser-movimientos.test.js` | nuevo |
| `test/fixtures/generar_pdf_prueba_movimientos.py` | nuevo |
| `test/integracion-movimientos.test.js` | nuevo |
| `sondear_pdfjs.cjs` | nuevo |
| `README.md` | formatos admitidos, carga múltiple, limitación del truncado |
