"""Gera o recorte de limites municipais usado como mapa de fundo offline do painel.

Fonte: malha municipal do IBGE para Minas Gerais, redistribuída em GeoJSON por
https://github.com/tbrugz/geodata-br (arquivo geojson/geojs-31-mun.json).

Uso:
    python3 painel/scripts/gerar_municipios.py caminho/geojs-31-mun.json painel/geo/municipios.json
"""

import json
import sys

# Janela do Quadrilátero Ferrífero que cobre os sites do Complexo Paraopeba (lon/lat).
JANELA = (-44.50, -20.90, -43.40, -19.75)
TOLERANCIA = 0.0015  # graus (~150 m): suficiente para escala regional


def simplificar(pontos, tol):
    """Douglas-Peucker iterativo."""
    if len(pontos) < 4:
        return pontos
    manter = [False] * len(pontos)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pontos) - 1)]
    while pilha:
        ini, fim = pilha.pop()
        (x1, y1), (x2, y2) = pontos[ini][:2], pontos[fim][:2]
        dx, dy = x2 - x1, y2 - y1
        norma = (dx * dx + dy * dy) ** 0.5
        maior, idx = 0.0, None
        for i in range(ini + 1, fim):
            x, y = pontos[i][:2]
            if norma == 0:  # anel fechado: extremos coincidem, mede distância ao ponto
                d = ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            else:
                d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norma
            if d > maior:
                maior, idx = d, i
        if idx is not None and maior > tol:
            manter[idx] = True
            pilha += [(ini, idx), (idx, fim)]
    return [p for p, m in zip(pontos, manter) if m]


def area_centroide(anel):
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(anel, anel[1:]):
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    a /= 2
    if abs(a) < 1e-12:
        return 0.0, anel[0]
    return abs(a), (cx / (6 * a), cy / (6 * a))


def poligonos(geom):
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def main(origem, destino):
    dados = json.load(open(origem, encoding="utf-8"))
    saida = []
    for f in dados["features"]:
        polys = poligonos(f["geometry"])
        xs = [p[0] for poly in polys for p in poly[0]]
        ys = [p[1] for poly in polys for p in poly[0]]
        if not (max(xs) > JANELA[0] and min(xs) < JANELA[2] and max(ys) > JANELA[1] and min(ys) < JANELA[3]):
            continue
        novos, maior = [], (0.0, None)
        for poly in polys:
            aneis = []
            for anel in poly:
                s = [[round(x, 4), round(y, 4)] for x, y in (p[:2] for p in simplificar(anel, TOLERANCIA))]
                if len(s) >= 4:
                    aneis.append(s)
            if aneis:
                novos.append(aneis)
                area, c = area_centroide(aneis[0])
                if area > maior[0]:
                    maior = (area, c)
        if not novos:
            continue
        cx, cy = maior[1] if maior[1] else ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
        rotulo = [round(cx, 4), round(cy, 4)]
        saida.append({
            "type": "Feature",
            "properties": {"nome": f["properties"]["name"], "cod": f["properties"]["id"], "rotulo": rotulo},
            "geometry": {"type": "MultiPolygon", "coordinates": novos},
        })
    json.dump({"type": "FeatureCollection", "features": saida}, open(destino, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{len(saida)} municípios -> {destino}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
