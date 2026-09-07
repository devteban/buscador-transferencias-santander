#!/usr/bin/env python3
"""
Sondeo de ESTRUCTURA de un PDF, sin revelar datos.

Que hace:
  1. Extrae el texto de unas pocas paginas repartidas por todo el documento.
  2. Decide que palabras son PLANTILLA (aparecen en la mayoria de las paginas
     muestreadas: etiquetas, cabeceras, pies) y cuales son DATOS (el resto).
  3. Imprime el texto con los DATOS enmascarados:
        digitos    -> #
        mayusculas -> X
        minusculas -> x
     conservando espacios, puntuacion y posicion en la linea.

Lo que NUNCA sale por pantalla: ningun nombre, importe, concepto ni numero real.
Lo que SI sale: las etiquetas fijas del documento y la forma de los valores.

Uso:
    python3 sondeo_estructura.py ejemplo.pdf
    python3 sondeo_estructura.py ejemplo.pdf --paginas 16 --umbral 0.6
    python3 sondeo_estructura.py ejemplo.pdf --ocultar APELLIDO OTRAPALABRA

Revisa la salida antes de compartirla. Si ves alguna palabra que no deberia
conservarse, vuelve a ejecutarlo con --ocultar PALABRA para forzar su mascara,
o sube el --umbral (mas alto = se conservan menos palabras).
"""

import argparse
import re
import sys
from collections import Counter

WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]+")
DIGIT_RE = re.compile(r"[0-9]")

# Palabras que jamas se conservan aunque parezcan plantilla.
NUNCA_CONSERVAR = set()


def extraer(pagina):
    """Texto de una pagina, intentando conservar la disposicion en columnas."""
    try:
        return pagina.extract_text(extraction_mode="layout") or ""
    except (TypeError, ValueError):
        return pagina.extract_text() or ""


def enmascarar_palabra(w):
    return "".join("X" if c.isupper() else "x" for c in w)


def enmascarar(texto, plantilla):
    texto = DIGIT_RE.sub("#", texto)

    def _sub(m):
        w = m.group(0)
        if w.lower() in plantilla:
            return w
        return enmascarar_palabra(w)

    return WORD_RE.sub(_sub, texto)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--paginas", type=int, default=12,
                    help="paginas a muestrear, repartidas por el documento")
    ap.add_argument("--mostrar", type=int, default=3,
                    help="paginas enmascaradas a imprimir enteras")
    ap.add_argument("--umbral", type=float, default=0.6,
                    help="fraccion de paginas en que debe salir una palabra "
                         "para considerarla plantilla")
    ap.add_argument("--ocultar", nargs="*", default=[],
                    help="palabras a enmascarar siempre")
    args = ap.parse_args()

    NUNCA_CONSERVAR.update(w.lower() for w in args.ocultar)

    try:
        from pypdf import PdfReader
    except ImportError:
        sys.exit("Falta pypdf:  python3 -m pip install --user pypdf")

    reader = PdfReader(args.pdf)
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            sys.exit("PDF cifrado: hace falta contrasena.")

    total = len(reader.pages)
    n = min(args.paginas, total)
    # Muestra repartida: primeras paginas + reparto uniforme por todo el PDF.
    idx = sorted(set([0, 1] + [round(i * (total - 1) / max(n - 1, 1))
                               for i in range(n)]))[:n]

    paginas = []
    for i in idx:
        paginas.append((i, extraer(reader.pages[i])))

    # --- 1. Diagnostico: hay capa de texto o es un escaneo? -----------------
    print("=" * 72)
    print("1. DIAGNOSTICO")
    print("=" * 72)
    print(f"Paginas totales: {total}")
    print(f"Paginas muestreadas: {[i + 1 for i in idx]}")
    chars = [len(t) for _, t in paginas]
    print(f"Caracteres extraidos por pagina: min={min(chars)} "
          f"max={max(chars)} media={sum(chars) // len(chars)}")
    if max(chars) < 50:
        print(">>> SIN CAPA DE TEXTO: el PDF es probablemente un escaneo. "
              "Haria falta OCR.")
    else:
        print(">>> Hay capa de texto extraible.")
    lineas_por_pag = [len([l for l in t.splitlines() if l.strip()])
                      for _, t in paginas]
    print(f"Lineas no vacias por pagina: min={min(lineas_por_pag)} "
          f"max={max(lineas_por_pag)}")

    # --- 2. Vocabulario de plantilla ---------------------------------------
    apariciones = Counter()
    for _, t in paginas:
        for w in set(m.group(0).lower() for m in WORD_RE.finditer(t)):
            apariciones[w] += 1

    minimo = max(2, int(len(paginas) * args.umbral))
    plantilla = {w for w, c in apariciones.items()
                 if c >= minimo and w not in NUNCA_CONSERVAR}

    print()
    print("=" * 72)
    print("2. VOCABULARIO CONSERVADO (palabras tratadas como plantilla)")
    print("=" * 72)
    print(f"Criterio: aparece en >= {minimo} de {len(paginas)} paginas.")
    print("REVISA ESTA LISTA. Si hay algo que no sea una etiqueta del "
          "documento,\nrelanza con --ocultar esa_palabra\n")
    print("  " + "  ".join(sorted(plantilla)))

    # --- 3. Lineas mas frecuentes (el esqueleto del registro) --------------
    formas = Counter()
    for _, t in paginas:
        for linea in t.splitlines():
            if linea.strip():
                formas[enmascarar(linea.rstrip(), plantilla)] += 1

    print()
    print("=" * 72)
    print("3. LINEAS MAS REPETIDAS (enmascaradas) - el molde del registro")
    print("=" * 72)
    for forma, c in formas.most_common(30):
        print(f"[x{c:3d}] {forma}")

    # --- 4. Paginas completas enmascaradas ---------------------------------
    print()
    print("=" * 72)
    print("4. PAGINAS COMPLETAS ENMASCARADAS")
    print("=" * 72)
    for i, t in paginas[:args.mostrar]:
        print(f"\n----- pagina {i + 1} " + "-" * 50)
        print(enmascarar(t, plantilla))


if __name__ == "__main__":
    main()
