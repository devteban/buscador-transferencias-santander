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
