#!/usr/bin/env python3
"""
Genera un PDF de prueba que reproduce el molde de las ordenes de
transferencia, con datos COMPLETAMENTE INVENTADOS.

Existe para poder verificar la herramienta -- carga, extraccion, filtros,
exportacion -- sin abrir nunca el extracto real, que contiene datos
personales. Ninguna cifra, nombre ni IBAN de aqui procede de un documento
real.

    python3 test/fixtures/generar_pdf_prueba.py pdf-prueba.pdf
"""

import sys

ANCHO, ALTO = 842, 595
X_IZQ, X_CENTRO, X_DER = 20, 300, 560

# Tres transferencias inventadas, cada una con una variante distinta del
# molde: ordenante de 1/2/3 lineas, concepto de 1/3/2 lineas, importe con y
# sin separador de miles, y fechas incrustadas en el concepto.
TRANSFERENCIAS = [
    {
        "ordenante": ["AYUNTAMIENTO DE VILLARRIBA"],
        "importe": "345,00",
        "beneficiario": "EMPRESA EJEMPLO SL",
        "concepto": ["ALOJAMIENTO Y ALIMENTACION DE ANIMALES"],
        "envio": "05-02-2025", "operacion": "03-02-2025", "valor": "04-02-2025",
        "iban": "ES00 1111 2222 3333 4444 5555",
        "ref": "10001ABC001",
    },
    {
        "ordenante": ["AYUNTAMIENTO DE VILLABAJO", "DE LOS MONTES"],
        "importe": "12.345,67",
        "beneficiario": "EMPRESA EJEMPLO SL",
        "concepto": ["ALOJAMIENTO Y ALIMENTACION", "DE ANIMALES RECOGIDOS",
                     "EN VIA PUBLICA"],
        "envio": "12-03-2025", "operacion": "10-03-2025", "valor": "11-03-2025",
        "iban": "ES00 1111 2222 3333 4444 5555",
        "ref": "10002DEF002",
    },
    {
        "ordenante": ["MANCOMUNIDAD DE MUNICIPIOS", "DE LA COMARCA",
                      "DEL NORTE"],
        "importe": "980,50",
        "beneficiario": "EMPRESA EJEMPLO S L",
        "concepto": ["FACTURA FECHA 15.01.2025",
                     "PERIODO 01/01/2025 A 31/01/2025"],
        "envio": "20-04-2025", "operacion": "18-04-2025", "valor": "19-04-2025",
        "iban": "ES00 1111 2222 3333 4444 5555",
        "ref": "10003GHI003",
    },
]


def escapar(t):
    return t.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def texto(x, y, t, tam=8):
    return f"BT /F1 {tam} Tf 1 0 0 1 {x} {y} Tm ({escapar(t)}) Tj ET\n"


def contenido(tr):
    """Flujo de contenido de una pagina, siguiendo el molde del sondeo."""
    s = ""
    y = ALTO - 40
    s += texto(X_DER + 60, y, "Oficina:")
    y -= 14
    s += texto(X_DER, y, f"Fecha de envío: {tr['envio']}")
    y -= 14
    s += texto(X_IZQ, y, "TRANSFERENCIAS RECIBIDAS -    ORDEN DE TRANSFERENCIA")
    y -= 22
    s += texto(X_IZQ, y, "ORDENANTE")
    s += texto(X_CENTRO, y, "IMPORTE")
    s += texto(X_DER, y, "BENEFICIARIO")
    y -= 20

    # Linea del doble marcador
    s += texto(X_IZQ, y, tr["ordenante"][0])
    s += texto(X_CENTRO - 40, y, ">>")
    s += texto(X_CENTRO, y, f"{tr['importe']}  EUR")
    s += texto(X_DER - 40, y, ">>")
    s += texto(X_DER, y, tr["beneficiario"])
    y -= 12
    for cont in tr["ordenante"][1:]:
        s += texto(X_IZQ, y, cont)
        y -= 12

    s += texto(X_IZQ, y, "POR CUENTA DE:")
    s += texto(X_CENTRO, y, f"Importe origen: {tr['importe']} EUR")
    s += texto(X_DER, y, f"IBAN: {tr['iban']}")
    y -= 12
    s += texto(X_IZQ, y, "Entidad: BANCO EJEMPLO, S.A.")
    s += texto(X_CENTRO, y, "Cambio aplicado origen: 1,000000")
    s += texto(X_DER, y, f"Titular: {tr['beneficiario']}")
    y -= 12
    s += texto(X_CENTRO, y, f"Importe recibido: {tr['importe']} EUR")
    y -= 12
    s += texto(X_CENTRO, y, f"Contravalor: {tr['importe']} EUR")
    y -= 12
    s += texto(X_CENTRO, y, "TOTAL NUESTROS GASTOS : 0,00 EUR")
    y -= 22

    s += texto(X_IZQ, y, "CONCEPTO:")
    y -= 12
    for c in tr["concepto"]:
        s += texto(X_IZQ, y, c)
        y -= 12

    # Pie: "Nuestra Ref" pegada a "Fecha operacion", como en el molde real.
    s += texto(X_IZQ, 40,
               f"Refª Origen:   /   Nuestra Refª: {tr['ref']}"
               f"Fecha operación: {tr['operacion']}"
               f" / Fecha valor: {tr['valor']}")
    return s


def construir():
    objetos = []          # cada elemento es bytes, sin la cabecera "N 0 obj"
    n_pag = len(TRANSFERENCIAS)
    # 1 catalogo, 2 pages, 3..3+n-1 paginas, luego contenidos, luego fuente
    id_pags = [3 + i for i in range(n_pag)]
    id_conts = [3 + n_pag + i for i in range(n_pag)]
    id_fuente = 3 + 2 * n_pag

    kids = " ".join(f"{i} 0 R" for i in id_pags)
    objetos.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objetos.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pag} >>"
                   .encode("latin-1"))
    for i in range(n_pag):
        objetos.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {ANCHO} {ALTO}] "
            f"/Resources << /Font << /F1 {id_fuente} 0 R >> >> "
            f"/Contents {id_conts[i]} 0 R >>".encode("latin-1"))
    for tr in TRANSFERENCIAS:
        flujo = contenido(tr).encode("cp1252", errors="replace")
        objetos.append(b"<< /Length " + str(len(flujo)).encode() + b" >>\n"
                       b"stream\n" + flujo + b"endstream")
    objetos.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
                   b"/Encoding /WinAnsiEncoding >>")

    salida = bytearray(b"%PDF-1.4\n")
    desplazamientos = []
    for i, cuerpo in enumerate(objetos, start=1):
        desplazamientos.append(len(salida))
        salida += f"{i} 0 obj\n".encode() + cuerpo + b"\nendobj\n"

    inicio_xref = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n".encode()
    salida += b"0000000000 65535 f \n"
    for d in desplazamientos:
        salida += f"{d:010d} 00000 n \n".encode()
    salida += (f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\n"
               f"startxref\n{inicio_xref}\n%%EOF\n").encode()
    return bytes(salida)


if __name__ == "__main__":
    destino = sys.argv[1] if len(sys.argv) > 1 else "pdf-prueba.pdf"
    datos = construir()
    with open(destino, "wb") as f:
        f.write(datos)
    print(f"{destino}: {len(TRANSFERENCIAS)} paginas, {len(datos)} bytes")
