// Interfaz: carga del PDF, extraccion por lotes, tabla y exportacion.
// Todo el trabajo ocurre en local; este fichero no hace ninguna peticion
// de red, y el build garantiza que no haya ningun src externo.

const APP = {
  registros: [], anomalias: [],
  // Un documento PDF.js y sus bytes originales, por archivo cargado. Hace
  // falta saber de que archivo viene cada pagina para exportar a PDF: cada
  // fila puede pertenecer a un archivo distinto (Task 5).
  documentosPorArchivo: new Map(),
  // Archivos que fallaron en la ultima llamada a procesarArchivos, para que
  // pintarResultados pueda avisar de forma persistente (Task 5).
  fallosCarga: [],
  // Archivos que sustituyeron a otro con el mismo nombre en la ultima
  // llamada a procesarArchivos, para avisar de forma persistente (I2).
  sustituciones: [],
  // Evita que "Vaciar todo" (o una segunda carga) se solape con una carga
  // en curso: extraerDeDocumento cede el hilo entre lotes, y sin esta
  // bandera una carga interrumpida podria volcar registros huerfanos
  // sobre el APP ya vaciado (I3).
  procesando: false,
};

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

COLUMNAS.push(
  { clave: 'beneficiario', titulo: 'Beneficiario', tipo: 'texto',
    visible: false, extra: true },
  { clave: 'iban', titulo: 'IBAN', tipo: 'texto', visible: false, extra: true },
  { clave: 'titular', titulo: 'Titular', tipo: 'texto', visible: false, extra: true },
  { clave: 'entidad', titulo: 'Entidad', tipo: 'texto', visible: false, extra: true },
  { clave: 'oficina', titulo: 'Oficina', tipo: 'texto', visible: false, extra: true },
  { clave: 'nuestraRef', titulo: 'Nuestra Refª', tipo: 'texto',
    visible: false, extra: true },
  { clave: 'importeOrigen', titulo: 'Importe origen', tipo: 'moneda',
    visible: false, extra: true },
  { clave: 'importeRecibido', titulo: 'Importe recibido', tipo: 'moneda',
    visible: false, extra: true },
  { clave: 'contravalor', titulo: 'Contravalor', tipo: 'moneda',
    visible: false, extra: true },
  { clave: 'formato', titulo: 'Formato', tipo: 'texto', visible: false, extra: false },
  { clave: 'fila', titulo: 'Fila', tipo: 'num', visible: false, extra: false },
);

/** Valor de una columna, venga del registro o de registro.extra. */
function valorColumna(r, col) {
  return col.extra ? (r.extra[col.clave] ?? null) : r[col.clave];
}

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
  const col = COLUMNAS.find(c => c.clave === clave);
  const signo = ascendente ? 1 : -1;
  return [...registros].sort((a, b) => {
    const va = valorColumna(a, col), vb = valorColumna(b, col);
    const na = va === null || va === undefined;
    const nb = vb === null || vb === undefined;
    if (na && nb) return 0;
    if (na) return 1;   // los vacios siempre al final
    if (nb) return -1;
    if (va < vb) return -signo;
    if (va > vb) return signo;
    return 0;
  });
}

function el(tag, props = {}, hijos = []) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const h of [].concat(hijos)) {
    n.append(h instanceof Node ? h : document.createTextNode(h));
  }
  return n;
}

/**
 * Numero a formato espanol: punto para los miles, coma para los decimales.
 * Los importes secundarios se guardan como numero (para poder filtrar y
 * ordenar) y se formatean aqui, en la presentacion. El importe principal no
 * pasa por aqui: conserva importeTexto, el literal del PDF.
 */
function formatearImporte(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  // useGrouping: true es necesario a proposito: en 'es-ES', Intl no agrupa
  // por millares los numeros de cuatro cifras por defecto (p.ej. 1234,56
  // en vez de 1.234,56), y aqui se quiere el agrupado siempre.
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true,
  });
}

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

const TAM_LOTE = 25; // paginas por lote antes de ceder el hilo

/** Cede el control al navegador para que repinte entre lotes. */
const respirar = () => new Promise(r => setTimeout(r, 0));

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

/**
 * Abre el PDF pidiendo contrasena si hace falta. PDF.js avisa mediante
 * onPassword; se reintenta hasta que el usuario cancela.
 */
function abrirDocumento(datos) {
  // Sin cMapUrl ni standardFontDataUrl a proposito: sin esas URLs, PDF.js
  // aborta internamente en vez de intentar descargar fuentes o mapas de
  // caracteres. Es lo que garantiza que el PDF no salga de este equipo.
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

/**
 * Procesa varios archivos EN SERIE (no en paralelo, para no complicar la
 * memoria ni el progreso) y acumula sus registros y anomalias sobre lo que
 * ya hubiera cargado. Cada archivo abre su propio documento PDF.js y queda
 * registrado en APP.documentosPorArchivo (Task 5), para poder exportar a
 * PDF sabiendo de que archivo viene cada pagina.
 */
async function procesarArchivos(archivos, estado, barra) {
  // Evita que dos cargas se solapen (por ejemplo, pulsar "Añadir más PDF"
  // dos veces) y, sobre todo, que "Vaciar todo" pueda ejecutarse a mitad de
  // una carga: extraerDeDocumento cede el hilo entre lotes, y sin esta
  // bandera una carga interrumpida por un vaciado podria volcar registros
  // huerfanos sobre el APP ya vaciado (I3).
  if (APP.procesando) return;
  APP.procesando = true;
  try {
    barra.classList.remove('oculto');
    let huboExito = false;
    const fallos = [];
    const sustituciones = [];
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i];
      const prefijo = archivos.length > 1
        ? `Archivo ${i + 1} de ${archivos.length} (${archivo.name}): ` : '';
      estado.textContent = prefijo + 'Abriendo el PDF...';
      estado.className = 'sub';
      try {
        if (APP.documentosPorArchivo.has(archivo.name)) {
          // Recargar el mismo nombre se trata como sustituir ese archivo: se
          // destruye el documento viejo (si no, queda huerfano y nunca se
          // libera) y se purgan sus filas anteriores (si no, las filas
          // viejas seguirian apuntando al archivo nuevo al exportar, con
          // paginas equivocadas y sin ningun aviso).
          APP.documentosPorArchivo.get(archivo.name).documentoPdf.destroy();
          APP.registros = APP.registros.filter(r => r.archivo !== archivo.name);
          APP.anomalias = APP.anomalias.filter(a => a.archivo !== archivo.name);
          sustituciones.push(archivo.name);
        }
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
        fallos.push({ archivo: archivo.name, motivo: nombre || 'error desconocido' });
        // Un archivo que falla no aborta el resto de la cola.
        if (i < archivos.length - 1) continue;
      }
    }
    barra.classList.add('oculto');
    APP.fallosCarga = fallos;
    APP.sustituciones = sustituciones;
    if (huboExito) pintarResultados();
  } finally {
    APP.procesando = false;
  }
}

function campo(etiqueta, props, alCambiar) {
  const input = el('input', props);
  input.addEventListener('input', () => alCambiar(input.value));
  return el('label', {}, [etiqueta, input]);
}

// Repintar 1500 filas en cada pulsacion se nota al escribir. Se agrupa el
// filtrado en una sola pasada tras una pausa breve.
let temporizadorFiltro = null;
function programarFiltrado(alFiltrar) {
  clearTimeout(temporizadorFiltro);
  temporizadorFiltro = setTimeout(alFiltrar, 120);
}

function pintarFiltros(alFiltrar) {
  // Se escribe SIEMPRE sobre APP.criterios, nunca sobre una referencia
  // capturada: el boton de limpiar reasigna APP.criterios a un objeto nuevo,
  // y un cierre sobre el objeto antiguo dejaria los filtros sin efecto.
  const set = (k) => (v) => { APP.criterios[k] = v; programarFiltrado(alFiltrar); };
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
    clearTimeout(temporizadorFiltro);
    alFiltrar();
  });
  caja.append(limpiar);
  return caja;
}

/**
 * Texto del importe principal, con el codigo de moneda anadido cuando NO es
 * EUR. Sin esto, una transferencia en divisa (por ejemplo "1.200,00 USD")
 * se pintaria igual que una en euros: un error de lectura silencioso. El
 * molde real solo incluye "Cambio aplicado origen:" y "Contravalor:" para
 * transferencias en divisa, asi que la variante es previsible en 1500
 * paginas y contamina ademas sumas y filtros por rango si no se distingue.
 */
function textoImporte(r) {
  if (r.importeTexto == null) return null;
  if (r.moneda && r.moneda !== 'EUR') return `${r.importeTexto} ${r.moneda}`;
  return r.importeTexto;
}

function celda(r, col) {
  const v = valorColumna(r, col);
  if (col.clave === 'importe') {
    return el('td', { className: 'num',
                      textContent: textoImporte(r) || '—' });
  }
  if (col.tipo === 'fecha') {
    return el('td', { textContent: r[col.clave + 'Texto'] || '—' });
  }
  if (col.tipo === 'moneda') {
    return el('td', { className: 'num', textContent: formatearImporte(v) || '—' });
  }
  if (col.tipo === 'num' || col.tipo === 'importe') {
    return el('td', { className: 'num',
                      textContent: v === null || v === undefined ? '—' : String(v) });
  }
  return el('td', { textContent: v || '—' });
}

/** Columnas activadas en el selector "Columnas". Puede estar vacia. */
function columnasVisibles() {
  return COLUMNAS.filter(c => c.visible);
}

function pintarTabla(filas) {
  const visibles = columnasVisibles();
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
      if (col.clave === 'importe') return escapar(textoImporte(r));
      if (col.tipo === 'moneda') return escapar(formatearImporte(valorColumna(r, col)));
      if (col.tipo === 'fecha') return escapar(r[col.clave + 'Texto']);
      return escapar(valorColumna(r, col));
    }).join(';'));
  }
  return '﻿' + lineas.join('\r\n');
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(
    new Blob([contenido], { type: tipo }));
  const a = el('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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

function blobDeCanvas(canvas) {
  return new Promise((resolver, rechazar) => {
    canvas.toBlob(blob => {
      if (blob) resolver(blob);
      else rechazar(new Error('No se pudo codificar la página.'));
    }, 'image/jpeg', 0.92);
  });
}

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

/**
 * Copia las paginas filtradas sin rasterizarlas, archivo por archivo. Si
 * la copia directa no es posible para alguno (por ejemplo por su cifrado),
 * usa una copia visual como respaldo PARA TODO el resultado: mezclar
 * paginas copiadas directamente con paginas rasterizadas en el mismo PDF de
 * salida no aporta nada y complica el codigo sin necesidad.
 * Las paginas de un mismo archivo salen en el orden en que aparecen en la
 * tabla filtrada; los archivos entre si van en el orden de su primera
 * aparicion en la tabla, no intercalados.
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

function refrescar() {
  const filas = ordenar(filtrar(APP.registros, APP.criterios), APP.orden);
  APP.filas = filas;
  document.getElementById('contador').textContent =
    `${filas.length} de ${APP.registros.length} registros`;
  const cont = document.getElementById('tabla');
  cont.textContent = '';
  if (columnasVisibles().length === 0) {
    cont.append(el('p', { className: 'aviso',
      textContent: 'No hay ninguna columna seleccionada. Activa al menos una '
        + 'en «Columnas» para ver los resultados.' }));
    return;
  }
  cont.append(pintarTabla(filas));
}

/** Boton para descartar todo lo cargado y volver a la pantalla inicial. */
function botonVaciarTodo() {
  const boton = el('button', { textContent: 'Vaciar todo' });
  boton.addEventListener('click', () => {
    if (APP.procesando) {
      alert('Espera a que termine de cargar antes de vaciar.');
      return;
    }
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

function pintarResultados() {
  const app = document.getElementById('app');
  app.textContent = '';

  if (APP.registros.length === 0) {
    app.append(
      el('h1', { textContent: 'Buscador de registros' }),
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
    el('h1', { textContent: 'Buscador de registros' }),
    el('p', { className: 'sub',
      textContent: `${APP.registros.length} registros de `
        + `${archivosCargados.size} ${archivosCargados.size === 1 ? 'archivo' : 'archivos'}` }),
  ];
  // Anadido durante la ronda de fix de la Task 5: si algun archivo de la
  // ultima tanda cargada fallo, queda registrado en APP.fallosCarga y hay
  // que seguir mostrandolo aqui -- si no, esta sustitucion completa de
  // pintarResultados lo haria desaparecer en silencio.
  if (APP.fallosCarga && APP.fallosCarga.length > 0) {
    cabecera.push(el('p', { className: 'aviso',
      textContent: 'No se pudieron cargar: ' + APP.fallosCarga
        .map(f => `${f.archivo} (${f.motivo})`).join(', ') }));
  }
  if (APP.sustituciones && APP.sustituciones.length > 0) {
    cabecera.push(el('p', { className: 'sub aviso',
      textContent: 'Se sustituyó (ya había un archivo con el mismo nombre): '
        + APP.sustituciones.join(', ') }));
  }
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
    if (APP.procesando) {
      alert('Espera a que termine la carga en curso.');
      return;
    }
    await procesarArchivos([...e.target.files], estado, barra);
  });
  return el('span', {}, [boton, entrada, barra, estado]);
}

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

document.addEventListener('DOMContentLoaded', pintarInicio);
