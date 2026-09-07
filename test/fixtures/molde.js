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
