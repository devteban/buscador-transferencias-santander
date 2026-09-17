// Logica de extraccion. No conoce el DOM ni PDF.js: recibe lineas de texto
// con coordenadas y devuelve registros. Eso es lo que la hace testeable sin
// navegador y sin usar el PDF real.

const RE_IMPORTE = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d{1,3},\d{2}$/;
const RE_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/;

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
    if (limpio.startsWith('-')) { negativo = true; limpio = limpio.slice(1); }
    else if (limpio.endsWith('-')) { negativo = true; limpio = limpio.slice(0, -1); }
  }
  if (!RE_IMPORTE.test(limpio)) return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
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
 *
 * `excluir`, si se da, descarta cualquier fragmento que contenga esa
 * subcadena antes de buscar la etiqueta. Existe por "POR CUENTA DE:": en el
 * molde real esa etiqueta va vacia, y sin excluir "GASTOS POR CUENTA DE:"
 * (que la contiene como subcadena) la busqueda seguiria hasta ese fragmento
 * y devolveria el valor de un campo distinto.
 */
function valorTrasEtiqueta(lineas, etiqueta, patron, excluir) {
  for (const l of lineas) {
    for (const f of l.fragmentos) {
      if (excluir && f.texto.includes(excluir)) continue;
      const i = f.texto.indexOf(etiqueta);
      if (i === -1) continue;
      const m = patron.exec(f.texto.slice(i + etiqueta.length));
      if (m) return m[1];
    }
  }
  return null;
}

/**
 * "Oficina:" es un caso especial: en el molde real la etiqueta va sola en
 * su fragmento (nunca con el valor pegado) y el valor cae en la linea
 * siguiente, en la misma columna. valorTrasEtiqueta no sirve aqui porque
 * busca dentro del MISMO fragmento que la etiqueta; hace falta mirar la
 * linea de debajo.
 *
 * Se tolera tambien el caso "etiqueta y valor en la misma linea" por si
 * alguna variante del molde lo trae asi, pero el caso real observado es el
 * de dos lineas.
 */
function extraerOficina(lineas) {
  for (let i = 0; i < lineas.length; i++) {
    for (const f of lineas[i].fragmentos) {
      const idx = f.texto.indexOf('Oficina:');
      if (idx === -1) continue;
      const mismaLinea = f.texto.slice(idx + 'Oficina:'.length).trim();
      if (mismaLinea) return mismaLinea;
      if (i + 1 >= lineas.length) return null;
      // Misma columna: fragmentos de la linea siguiente cuya X esta cerca
      // de la X de la etiqueta (tolerancia generosa porque las columnas se
      // desplazan un poco entre paginas, ver "desplazamiento" en el molde).
      const columna = lineas[i + 1].fragmentos.filter(
        g => Math.abs(g.x - f.x) < 100);
      const valor = columna.map(g => g.texto).join(' ').trim();
      return valor || null;
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
      // 'IBAN:' e 'Importe origen:' NO son redundantes con 'POR CUENTA DE:'
      // y 'Entidad:' aunque en el molde observado siempre aparezcan juntas:
      // son el respaldo. Si a una pagina le falta 'POR CUENTA DE:' (la
      // revision confirmo que en el molde real esa etiqueta va vacia, ver
      // ARREGLO 2), es 'IBAN:' quien corta el bloque del ordenante a tiempo
      // y evita que arrastre media pagina.
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
    // 'GASTOS POR CUENTA DE:' contiene 'POR CUENTA DE:' como subcadena; en
    // el molde real esta ultima va vacia, asi que sin excluir la primera la
    // busqueda seguiria hasta ella y devolveria "COMPARTIDOS" (el valor de
    // otro campo) en vez de dejar porCuentaDe sin rellenar.
    ['porCuentaDe', 'POR CUENTA DE:', /^\s*(.+?)\s*$/, 'GASTOS POR CUENTA DE:'],
    ['nuestraRef', 'Nuestra Refª:', /^\s*(.+?)(?=Fecha operación:|$)/],
  ];
  for (const [clave, etiqueta, patron, excluir] of ETIQUETAS_EXTRA) {
    const v = valorTrasEtiqueta(lineas, etiqueta, patron, excluir);
    if (v && v.trim()) reg.extra[clave] = v.trim();
  }
  // 'Oficina:' se extrae aparte: en el molde real la etiqueta va sola y el
  // valor esta en la linea siguiente (ver extraerOficina).
  const oficina = extraerOficina(lineas);
  if (oficina) reg.extra.oficina = oficina;

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
 * termina en importe).
 *
 * RE_FECHA_SLASH_INICIO (comprobado por el llamante antes de invocar esta
 * funcion) garantiza que la linea empieza por una fecha, asi que fechas[0]
 * siempre existe. fechas[1] (fecha valor) puede faltar si esta rota o
 * ausente: en ese caso NO se descarta la fila -- se degrada como el resto
 * de campos, dejando fechaValor a null y disparando la anomalia de
 * campos incompletos, para no perder la fila en silencio.
 */
function parsearFilaMovimiento(lineaTexto, pagina, archivo, fila) {
  const fechas = [...lineaTexto.matchAll(RE_FECHA_SLASH_GLOBAL)];
  if (fechas.length === 0) return null; // no deberia poder pasar; red de seguridad

  const reg = registroVacioMovimientos(pagina, archivo, fila);

  const isoOp = normalizarFecha(fechas[0][0].replace(/\//g, '-'));
  if (isoOp) { reg.fechaOperacion = isoOp; reg.fechaOperacionTexto = fechas[0][0]; }

  let finFechas = fechas[0].index + fechas[0][0].length;
  if (fechas.length >= 2) {
    const isoVal = normalizarFecha(fechas[1][0].replace(/\//g, '-'));
    if (isoVal) { reg.fechaValor = isoVal; reg.fechaValorTexto = fechas[1][0]; }
    finFechas = fechas[1].index + fechas[1][0].length;
  }
  // Con fechas.length === 1, fechaValor queda null (registroVacioMovimientos
  // ya lo inicializa asi) y finFechas se calcula desde el final de la unica
  // fecha encontrada, para poder seguir extrayendo descripcion/importe.

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
