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

document.addEventListener('DOMContentLoaded', pintarInicio);
