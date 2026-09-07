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
