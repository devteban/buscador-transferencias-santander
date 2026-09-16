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

/**
 * UNA fila de un listado de movimientos, ya como Linea reconstruida (no
 * como fragmentos en bruto de PDF.js): parsearPaginaMovimientos recibe
 * lineas, igual que parsearPagina (formato 1) recibe las que construye
 * paginaMolde. La geometria real del documento (fuente pequena, fila
 * partida en dos sub-alturas) es asunto de agruparEnLineas/
 * tolerenciaAdaptativa (Task 2, ya verificadas contra el documento real por
 * separado) y de la prueba de integracion (Task 4, con un PDF generado que
 * SI reproduce esa geometria); aqui no hace falta reproducirla para probar
 * la extraccion de campos de una fila ya bien formada.
 *
 * Todos los valores son inventados.
 */
export function filaMovimientos(y, opciones = {}) {
  const o = {
    fechaOperacion: '16/03/2025',
    fechaValor: '17/03/2025',
    descripcion: 'Transferencia De Ayuntamiento De Villarriba, Concepto Servicio 123',
    importe: '1.234,56',
    ...opciones,
  };
  const pares = [20, o.fechaOperacion, 90, o.fechaValor];
  if (o.descripcion) pares.push(160, o.descripcion);
  if (o.importe !== null) pares.push(600, o.importe);
  return linea(y, ...pares);
}

/**
 * Pagina sintetica de listado de movimientos, ya como array de Lineas:
 * titulo, cabecera de columnas (solo si conCabecera, como en el molde real,
 * que solo la repite en la primera pagina del documento) y N filas.
 * `filas` es un array de opciones para filaMovimientos (una entrada por
 * fila).
 */
export function paginaMovimientos(filas, opciones = {}) {
  const o = { conCabecera: true, ...opciones };
  const lineas = [];
  let y = 760;
  if (o.conCabecera) {
    lineas.push(linea(y, 20, 'Movimientos cuenta desde 01/01/2025 hasta 31/12/2025'));
    y -= 20;
    lineas.push(linea(y, 20, 'Fecha Operacion', 90, 'Fecha Valor',
                       160, 'Concepto', 600, 'Importe'));
    y -= 20;
  }
  for (const opcionesFila of filas) {
    lineas.push(filaMovimientos(y, opcionesFila));
    y -= 12;
  }
  return lineas;
}
