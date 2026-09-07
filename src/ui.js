// Interfaz: carga del PDF, extraccion por lotes, tabla y exportacion.
// Todo el trabajo ocurre en local; este fichero no hace ninguna peticion
// de red, y el build garantiza que no haya ningun src externo.

const APP = { registros: [], anomalias: [], nombreArchivo: '' };

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

const TAM_LOTE = 25; // paginas por lote antes de ceder el hilo

/** Cede el control al navegador para que repinte entre lotes. */
const respirar = () => new Promise(r => setTimeout(r, 0));

async function extraerTodo(doc, alProgresar) {
  const registros = [], anomalias = [];
  for (let inicio = 1; inicio <= doc.numPages; inicio += TAM_LOTE) {
    const fin = Math.min(inicio + TAM_LOTE - 1, doc.numPages);
    for (let n = inicio; n <= fin; n++) {
      let pagina = null;
      try {
        pagina = await doc.getPage(n);
        const contenido = await pagina.getTextContent();
        const lineas = agruparEnLineas(contenido.items);
        const { registro, anomalia } = parsearPagina(lineas, n);
        if (registro) registros.push(registro);
        if (anomalia) anomalias.push(anomalia);
      } catch (err) {
        anomalias.push({ pagina: n, motivo: 'error_parser',
                         camposFaltantes: [], detalle: err.message });
      } finally {
        if (pagina) pagina.cleanup();
      }
    }
    alProgresar(fin, doc.numPages);
    await respirar();
  }
  return { registros, anomalias };
}

async function procesar(archivo, estado, barra) {
  APP.nombreArchivo = archivo.name;
  estado.textContent = 'Abriendo el PDF...';
  barra.classList.remove('oculto');
  try {
    const datos = new Uint8Array(await archivo.arrayBuffer());
    // Sin cMapUrl ni standardFontDataUrl a proposito: sin esas URLs, PDF.js
    // aborta internamente en vez de intentar descargar fuentes o mapas de
    // caracteres. Es lo que garantiza que el PDF no salga de este equipo.
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
  } catch (err) {
    barra.classList.add('oculto');
    estado.textContent = 'No se pudo abrir: ' + err.message;
    estado.className = 'sub aviso';
  }
}

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

  const otro = el('button', { textContent: 'Cargar otro PDF' });
  otro.addEventListener('click', () => {
    APP.registros = []; APP.anomalias = []; APP.criterios = {};
    APP.orden = { clave: 'pagina', ascendente: true };
    pintarInicio();
  });

  app.append(
    el('h1', { textContent: 'Buscador de transferencias' }),
    el('p', { className: 'sub',
      textContent: `${APP.registros.length} transferencias de `
        + `${APP.nombreArchivo}, procesadas en ${segundos} s` }),
    otro,
    panelAnomalias(),
    pintarFiltros(refrescar),
    el('p', { id: 'contador', className: 'sub' }),
    el('div', { id: 'tabla' }),
  );
  refrescar();
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

document.addEventListener('DOMContentLoaded', pintarInicio);
