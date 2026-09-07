// Logica de extraccion. No conoce el DOM ni PDF.js: recibe lineas de texto
// con coordenadas y devuelve registros. Eso es lo que la hace testeable sin
// navegador y sin usar el PDF real.

const RE_IMPORTE = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d{1,3},\d{2}$/;
const RE_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/;

export function normalizarImporte(texto) {
  if (typeof texto !== 'string') return null;
  // Se recortan los extremos y el codigo de moneda, pero NUNCA los espacios
  // internos: el texto viene de fragmentos de PDF unidos con espacios, y
  // borrarlos convertiria "12 3,45" en un importe valido de 123,45.
  const limpio = texto.trim().replace(/\s*[A-Z]{3}$/, '').trim();
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

// Tolerancia vertical para decidir si dos fragmentos son la misma linea.
// PDF.js casi nunca da Y identica; media altura de fuente es el criterio
// habitual, con un minimo para fuentes muy pequenas.
function toleranciaY(alturaFuente) {
  return Math.max(2, alturaFuente * 0.5);
}

export function agruparEnLineas(items) {
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

  const grupos = [];
  let actual = null;
  let anterior = null;
  for (const f of utiles) {
    // La tolerancia es la mayor de las dos alturas implicadas, para que
    // unir A con B de el mismo resultado que unir B con A.
    const tol = anterior === null
      ? 0
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

export const MARCADOR = 'ORDEN DE TRANSFERENCIA';

const CAMPOS_NUCLEO = ['ordenante', 'importe', 'concepto',
                       'fechaOperacion', 'fechaValor', 'fechaEnvio'];

/** Primera linea cuyo texto contiene la subcadena dada. */
function buscarLinea(lineas, subcadena) {
  return lineas.find(l => l.texto.includes(subcadena)) || null;
}

/**
 * Indice de la linea de pie. Se identifica exigiendo que contenga LAS DOS
 * etiquetas de fecha a la vez, y se busca desde el final: asi el texto de un
 * concepto que mencione "Fecha operación:" no puede hacerse pasar por el pie.
 */
function indiceLineaPie(lineas) {
  for (let i = lineas.length - 1; i >= 0; i--) {
    const t = lineas[i].texto;
    if (t.includes('Fecha operación:') && t.includes('Fecha valor:')) return i;
  }
  return -1;
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

  const iPie = indiceLineaPie(lineas);

  // --- Ancla 1: la linea con los dos ">>" ---
  const iMarca = lineas.findIndex(
    l => l.fragmentos.some(f => f.texto.includes('>>')));
  if (iMarca !== -1) {
    const lm = lineas[iMarca];
    const marcas = lm.fragmentos.filter(f => f.texto.includes('>>'));
    // Se exigen las dos marcas. Con una sola, el "centro" absorberia al
    // beneficiario; es preferible dejar los campos vacios y que salte la
    // anomalia a extraer algo que podria ser incorrecto.
    if (marcas.length >= 2) {
      const xPrimera = marcas[0].x;
      const xSegunda = marcas[1].x;

      const izquierda = lm.fragmentos.filter(f => f.x < xPrimera);
      const centro = lm.fragmentos.filter(
        f => f.x > xPrimera && f.x < xSegunda && !f.texto.includes('>>'));
      const derecha = lm.fragmentos.filter(
        f => f.x > xSegunda && !f.texto.includes('>>'));

      const partesOrdenante = [izquierda.map(f => f.texto).join(' ').trim()];

      // Etiquetas que cierran el bloque del ordenante. Sin una cota, una pagina
      // a la que le falte alguna arrastraria el concepto y el pie dentro del
      // nombre del ordenante, y ademas sin marcar anomalia.
      const FIN_ORDENANTE = ['POR CUENTA DE:', 'Entidad:', 'CONCEPTO:',
                             'IBAN:', 'Importe origen:', 'Fecha operación:'];
      for (let i = iMarca + 1; i < lineas.length; i++) {
        if (iPie !== -1 && i >= iPie) break;
        const t = lineas[i].texto;
        if (FIN_ORDENANTE.some(e => t.includes(e))) break;
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
  }

  // --- Ancla 2: CONCEPTO: hasta la linea de pie ---
  const iConcepto = lineas.findIndex(l => l.texto.includes('CONCEPTO:'));
  if (iConcepto !== -1) {
    const partes = [];
    const mismaLinea = lineas[iConcepto].texto
      .split('CONCEPTO:')[1];
    if (mismaLinea && mismaLinea.trim()) partes.push(mismaLinea.trim());
    const limite = iPie === -1 ? lineas.length : iPie;
    for (let i = iConcepto + 1; i < limite; i++) {
      const t = lineas[i].texto.trim();
      if (t) partes.push(t);
    }
    const concepto = partes.join(' ').replace(/\s+/g, ' ').trim();
    if (concepto) reg.concepto = concepto;
  }

  // "Fecha de envío" vive en la cabecera; las otras dos, solo en el pie.
  // Restringir la busqueda es lo que impide que una fecha escrita dentro del
  // concepto se cuele como si fuera la fecha real de la operacion.
  const lineasPie = iPie === -1 ? [] : [lineas[iPie]];
  const pares = [
    ['fechaOperacion', 'Fecha operación:', lineasPie],
    ['fechaValor', 'Fecha valor:', lineasPie],
    ['fechaEnvio', 'Fecha de envío:', lineas],
  ];
  for (const [campo, etiqueta, donde] of pares) {
    const bruto = valorTrasEtiqueta(donde, etiqueta, TRAS_FECHA);
    const iso = normalizarFecha(bruto);
    if (iso) {
      reg[campo] = iso;
      reg[`${campo}Texto`] = bruto;
    }
  }

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
