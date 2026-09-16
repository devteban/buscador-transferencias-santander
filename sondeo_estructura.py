#!/usr/bin/env python3
"""
Sondeo de ESTRUCTURA de un PDF, sin revelar datos.

Que hace:
  1. Extrae el texto de unas pocas paginas repartidas por todo el documento.
  2. Decide que palabras son PLANTILLA (etiquetas, cabeceras, pies) y cuales
     son DATOS (el resto), contando en cuantos REGISTROS aparece cada
     palabra. Un "registro" es una PAGINA (--modo pagina, por defecto) o una
     LINEA (--modo linea).
  3. Imprime el texto con los DATOS enmascarados:
        digitos    -> #
        mayusculas -> X
        minusculas -> x
     conservando espacios, puntuacion y posicion en la linea.

Lo que NUNCA sale por pantalla: ningun nombre, importe, concepto ni numero
real (los digitos se enmascaran siempre, sin excepcion posible).
Lo que SI sale: las etiquetas fijas del documento y la forma de los valores.

--modo pagina (por defecto): para documentos de 1 registro por pagina (p.ej.
    una orden de transferencia por pagina). El criterio es "aparece en la
    mayoria de las paginas muestreadas".

--modo linea: para documentos TABULARES, con muchas filas de datos por
    pagina (p.ej. un listado de movimientos). En modo pagina, una palabra
    que por casualidad aparece en 2-3 filas de las pocas paginas muestreadas
    ya se cuela como "plantilla" aunque sea un dato real (un nombre, un
    pueblo). En modo linea el criterio se calcula sobre el total de LINEAS
    muestreadas, con un umbral mucho mas exigente por defecto: una palabra
    solo se conserva si aparece en la inmensa mayoria de las filas, que es
    lo que de verdad distingue una etiqueta de columna de un valor que se
    repite por azar.

Uso:
    python3 sondeo_estructura.py ejemplo.pdf
    python3 sondeo_estructura.py ejemplo.pdf --paginas 16 --umbral 0.6
    python3 sondeo_estructura.py ejemplo.pdf --modo linea --umbral 0.5
    python3 sondeo_estructura.py ejemplo.pdf --ocultar APELLIDO OTRAPALABRA

Revisa la salida ANTES de compartirla (ejecuta esto tu mismo en tu propia
terminal, no dejes que nadie mas lo ejecute por ti). Presta especial
atencion a la seccion 2: es una lista de palabras sueltas, y es donde puede
colarse un dato real. Si ves algo que no sea una etiqueta del documento,
relanza con --ocultar PALABRA, o sube el --umbral (mas alto = se conservan
menos palabras), o cambia de --modo si el documento es tabular.
"""

import argparse
import re
import sys
from collections import Counter

WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]+")
DIGIT_RE = re.compile(r"[0-9]")
IMPORTE_RE = re.compile(r"\d[.,]\d{2}\b")
FECHA_RE = re.compile(r"\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b")

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


def es_linea_mayusculas_sin_digitos(linea):
    """Candidata a cabecera/etiqueta de columna: todo en mayusculas, sin
    ningun digito. No dice nada sobre el CONTENIDO, solo sobre la forma."""
    letras = [c for c in linea if c.isalpha()]
    return bool(letras) and all(c.isupper() for c in letras) \
        and not any(c.isdigit() for c in linea)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--paginas", type=int, default=12,
                    help="paginas a muestrear, repartidas por el documento")
    ap.add_argument("--mostrar", type=int, default=3,
                    help="paginas enmascaradas a imprimir enteras")
    ap.add_argument("--modo", choices=["pagina", "linea"], default="pagina",
                    help="unidad de conteo para decidir que es plantilla: "
                         "'pagina' (1 registro por pagina, por defecto) o "
                         "'linea' (documento tabular, muchas filas/pagina)")
    ap.add_argument("--umbral", type=float, default=None,
                    help="fraccion de registros (paginas o lineas, segun "
                         "--modo) en que debe salir una palabra para "
                         "considerarla plantilla. Por defecto: 0.6 en modo "
                         "pagina, 0.5 en modo linea (mas exigente porque "
                         "hay muchos mas registros)")
    ap.add_argument("--ocultar", nargs="*", default=[],
                    help="palabras a enmascarar siempre")
    args = ap.parse_args()
    umbral = args.umbral if args.umbral is not None else (
        0.5 if args.modo == "linea" else 0.6)

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

    lineas_por_pagina = [
        (i, [l for l in t.splitlines() if l.strip()]) for i, t in paginas
    ]
    todas_las_lineas = [l for _, ls in lineas_por_pagina for l in ls]

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
    conteo_lineas = [len(ls) for _, ls in lineas_por_pagina]
    print(f"Lineas no vacias por pagina: min={min(conteo_lineas)} "
          f"max={max(conteo_lineas)}  (total muestreado: "
          f"{len(todas_las_lineas)})")
    palabras_por_linea = [len(WORD_RE.findall(l)) for l in todas_las_lineas]
    media_palabras = sum(palabras_por_linea) / max(len(palabras_por_linea), 1)
    con_importe = sum(1 for l in todas_las_lineas if IMPORTE_RE.search(l))
    con_fecha = sum(1 for l in todas_las_lineas if FECHA_RE.search(l))
    mayus_sin_digito = sum(1 for l in todas_las_lineas
                           if es_linea_mayusculas_sin_digitos(l))
    tot = max(len(todas_las_lineas), 1)
    print(f"Palabras por linea (media): {media_palabras:.1f}")
    print(f"Lineas con patron de importe (n.nn): {con_importe} "
          f"({100*con_importe/tot:.0f}%)")
    print(f"Lineas con patron de fecha: {con_fecha} ({100*con_fecha/tot:.0f}%)")
    print(f"Lineas en mayusculas sin digitos (candidatas a cabecera de "
          f"columna): {mayus_sin_digito} ({100*mayus_sin_digito/tot:.0f}%)")
    if max(conteo_lineas) > 25 and args.modo == "pagina":
        print(">>> AVISO: muchas lineas por pagina. Si esto es un listado "
              "con varias filas de datos por pagina (no 1 registro por "
              "pagina), relanza con --modo linea.")

    # --- 2. Vocabulario de plantilla ---------------------------------------
    apariciones = Counter()
    if args.modo == "linea":
        registros = todas_las_lineas
    else:
        registros = [t for _, t in paginas]
    for r in registros:
        for w in set(m.group(0).lower() for m in WORD_RE.finditer(r)):
            apariciones[w] += 1

    minimo = max(2, int(len(registros) * umbral))
    plantilla = {w for w, c in apariciones.items()
                 if c >= minimo and w not in NUNCA_CONSERVAR}

    print()
    print("=" * 72)
    print("2. VOCABULARIO CONSERVADO (palabras tratadas como plantilla)")
    print("=" * 72)
    unidad = "lineas" if args.modo == "linea" else "paginas"
    print(f"Modo: {args.modo}. Criterio: aparece en >= {minimo} de "
          f"{len(registros)} {unidad} (umbral {umbral}).")
    print("REVISA ESTA LISTA. Si hay algo que no sea una etiqueta del "
          "documento,\nrelanza con --ocultar esa_palabra, o sube --umbral, "
          "o cambia --modo.\n")
    print("  " + "  ".join(sorted(plantilla)) if plantilla
          else "  (vacio: ninguna palabra alcanzo el criterio)")

    # --- 3. Lineas identicas repetidas entre paginas (candidatas a cabecera)
    # Evidencia mas fuerte que la frecuencia de palabras sueltas: dos filas
    # de datos reales (fecha+importe+concepto distintos) casi nunca coinciden
    # letra por letra entre paginas separadas del documento. Una linea que SI
    # coincide byte a byte en >=2 paginas es, con muchisima probabilidad,
    # texto fijo (cabecera, pie, titulo de columna), no un dato.
    apariciones_linea_exacta = Counter()
    paginas_por_linea = {}
    for i, ls in lineas_por_pagina:
        for l in set(l.strip() for l in ls):
            apariciones_linea_exacta[l] += 1
            paginas_por_linea.setdefault(l, set()).add(i + 1)

    repetidas = [(l, c) for l, c in apariciones_linea_exacta.items() if c >= 2]
    repetidas.sort(key=lambda x: -x[1])

    print()
    print("=" * 72)
    print("3. LINEAS IDENTICAS EN VARIAS PAGINAS (candidatas a cabecera fija)")
    print("=" * 72)
    print("Se muestran SIN enmascarar las palabras (solo los digitos se "
          "enmascaran, como siempre), porque repetirse letra por letra en "
          "paginas distintas es indicio fuerte de ser texto fijo.\n")
    if repetidas:
        for l, c in repetidas[:30]:
            print(f"[x{c:2d}] {DIGIT_RE.sub('#', l)}")
    else:
        print("  (ninguna linea se repite identica en 2 o mas paginas)")

    # --- 4. Lineas mas frecuentes (el esqueleto del registro) --------------
    formas = Counter()
    for _, t in paginas:
        for linea in t.splitlines():
            if linea.strip():
                formas[enmascarar(linea.rstrip(), plantilla)] += 1

    print()
    print("=" * 72)
    print("4. LINEAS MAS REPETIDAS (enmascaradas) - el molde del registro")
    print("=" * 72)
    for forma, c in formas.most_common(30):
        print(f"[x{c:3d}] {forma}")

    # --- 5. Paginas completas enmascaradas ---------------------------------
    print()
    print("=" * 72)
    print("5. PAGINAS COMPLETAS ENMASCARADAS")
    print("=" * 72)
    for i, t in paginas[:args.mostrar]:
        print(f"\n----- pagina {i + 1} " + "-" * 50)
        print(enmascarar(t, plantilla))


if __name__ == "__main__":
    main()
