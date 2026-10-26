"""Confere o projeto .pbip gerado antes de abri-lo no Power BI Desktop.

1. Todos os JSON com "$schema" contra os esquemas oficiais (clone de github.com/microsoft/json-schemas).
2. Todo campo usado nos visuais existe no modelo (coluna ou medida, na tabela certa).
3. Referências das expressões DAX e das colunas de ordenação existem.
4. Sintaxe das consultas Power Query (M), com o parser oficial da Microsoft (node + @microsoft/powerquery-parser).

Uso:
    python3 powerbi/validar_pbip.py dist/pbip --esquemas ../json-schemas
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PREFIXO = "https://developer.microsoft.com/json-schemas/"


def carregar(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def validar_esquemas(raiz, esquemas):
    from jsonschema import Draft7Validator
    from referencing import Registry, Resource

    def buscar(uri):
        if not uri.startswith(PREFIXO):
            raise LookupError(uri)
        return Resource.from_contents(carregar(Path(esquemas) / uri[len(PREFIXO):].split("#")[0]))

    registro = Registry(retrieve=buscar)
    erros = 0
    arquivos = [p for p in Path(raiz).rglob("*") if p.is_file() and p.suffix in (".json", ".pbir", ".pbism", ".pbip", ".platform")]
    for arq in sorted(arquivos):
        dados = carregar(arq)
        uri = dados.get("$schema") if isinstance(dados, dict) else None
        if not uri or not uri.startswith(PREFIXO):
            continue
        esquema = buscar(uri).contents
        validador = Draft7Validator(esquema, registry=registro)
        for e in validador.iter_errors(dados):
            erros += 1
            print(f"  ESQUEMA {arq.relative_to(raiz)}: {'/'.join(map(str, e.absolute_path))}: {e.message[:200]}")
    print(f"Esquemas: {len(arquivos)} arquivos conferidos, {erros} erro(s)")
    return erros


def campos_do_modelo(bim):
    colunas, medidas = set(), set()
    for t in bim["model"]["tables"]:
        for c in t.get("columns", []):
            colunas.add((t["name"], c["name"]))
        for m in t.get("measures", []):
            medidas.add((t["name"], m["name"]))
    return colunas, medidas


def referencias(no):
    """Gera (tipo, tabela, propriedade) para cada Column/Measure com SourceRef.Entity."""
    if isinstance(no, dict):
        for tipo in ("Column", "Measure"):
            alvo = no.get(tipo)
            if isinstance(alvo, dict) and "Entity" in alvo.get("Expression", {}).get("SourceRef", {}):
                yield tipo, alvo["Expression"]["SourceRef"]["Entity"], alvo["Property"]
        for v in no.values():
            yield from referencias(v)
    elif isinstance(no, list):
        for v in no:
            yield from referencias(v)


def validar_campos(raiz, bim):
    colunas, medidas = campos_do_modelo(bim)
    erros = 0
    for arq in sorted(Path(raiz).rglob("visual.json")):
        v = carregar(arq)
        if len(v["name"]) > 50:
            erros += 1
            print(f"  NOME longo demais: {v['name']}")
        for tipo, tabela, prop in referencias(v):
            ok = (tabela, prop) in (colunas if tipo == "Column" else medidas)
            if not ok:
                erros += 1
                print(f"  CAMPO inexistente em {arq.parent.name}: {tipo} {tabela}[{prop}]")
    # imagens referenciadas precisam estar registradas no report.json e existir na pasta
    relatorio = next(Path(raiz).rglob("report.json"))
    registrados = {i["name"] for pk in carregar(relatorio).get("resourcePackages", []) for i in pk["items"]}
    for arq in sorted(Path(raiz).rglob("visual.json")):
        for item in re.findall(r'"ItemName": "([^"]+)"', arq.read_text(encoding="utf-8")):
            pasta = relatorio.parent.parent / "StaticResources" / "RegisteredResources"
            if item not in registrados or not (pasta / item).exists():
                erros += 1
                print(f"  IMAGEM {item} usada em {arq.parent.name} não está registrada ou não existe")
    nomes_paginas = [carregar(p)["name"] for p in Path(raiz).rglob("page.json")]
    for p in Path(raiz).rglob("page.json"):
        visuais = [carregar(v)["name"] for v in (p.parent / "visuals").glob("*/visual.json")]
        if len(visuais) != len(set(visuais)):
            erros += 1
            print(f"  NOME de visual repetido em {p.parent.name}")
    if len(nomes_paginas) != len(set(nomes_paginas)):
        erros += 1
        print("  NOME de página repetido")
    print(f"Campos dos visuais: {erros} erro(s)")
    return erros


def validar_dax(bim):
    colunas, medidas = campos_do_modelo(bim)
    nomes_medidas = {m for _, m in medidas}
    erros = 0
    for t in bim["model"]["tables"]:
        nomes_col = {c["name"] for c in t.get("columns", [])}
        for c in t.get("columns", []):
            if c.get("sortByColumn") and c["sortByColumn"] not in nomes_col:
                erros += 1
                print(f"  ORDENAÇÃO {t['name']}[{c['name']}] -> coluna inexistente {c['sortByColumn']}")
        itens = [("coluna", c["name"], c["expression"]) for c in t.get("columns", []) if c.get("type") == "calculated"]
        itens += [("medida", m["name"], m["expression"]) for m in t.get("measures", [])]
        for tipo, nome, expr in itens:
            texto = "\n".join(expr) if isinstance(expr, list) else expr
            sem_strings = re.sub(r'"[^"]*"', '""', texto)
            if sem_strings.count("(") != sem_strings.count(")"):
                erros += 1
                print(f"  DAX parênteses desbalanceados em {tipo} {nome}")
            for tab, campo in re.findall(r"([A-Za-zÀ-ú_][\wÀ-ú]*)\s*\[([^\]]+)\]", sem_strings):
                if (tab, campo) not in colunas and (tab, campo) not in medidas:
                    erros += 1
                    print(f"  DAX {tipo} {nome}: referência inexistente {tab}[{campo}]")
            for campo in re.findall(r"(?<![\wÀ-ú\]])\s*\[([^\]]+)\]", re.sub(r"[A-Za-zÀ-ú_][\wÀ-ú]*\s*\[[^\]]+\]", "", sem_strings)):
                if campo not in nomes_medidas:
                    erros += 1
                    print(f"  DAX {tipo} {nome}: medida inexistente [{campo}]")
    print(f"DAX: {erros} erro(s)")
    return erros


def validar_m(bim):
    expressoes = []
    for t in bim["model"]["tables"]:
        for p in t.get("partitions", []):
            e = p["source"]["expression"]
            expressoes.append((f"partição {t['name']}", "\n".join(e) if isinstance(e, list) else e))
    for e in bim["model"].get("expressions", []):
        x = e["expression"]
        expressoes.append((f"expressão {e['name']}", "\n".join(x) if isinstance(x, list) else x))
    script = Path(__file__).with_name("validar_m.mjs")
    erros = 0
    with tempfile.TemporaryDirectory() as tmp:
        for nome, texto in expressoes:
            arq = Path(tmp) / "consulta.pq"
            arq.write_text(texto, encoding="utf-8")
            r = subprocess.run(["node", str(script), str(arq)], capture_output=True, text=True)
            if r.returncode != 0:
                erros += 1
                print(f"  M {nome}: {(r.stdout + r.stderr).strip()[:400]}")
    print(f"Power Query (M): {len(expressoes)} consultas conferidas, {erros} erro(s)")
    return erros


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("projeto", help="pasta gerada por gerar_pbip.py")
    ap.add_argument("--esquemas", required=True, help="clone local de github.com/microsoft/json-schemas")
    a = ap.parse_args()
    bim = carregar(next(Path(a.projeto).rglob("model.bim")))
    total = validar_esquemas(a.projeto, a.esquemas) + validar_campos(a.projeto, bim) + validar_dax(bim) + validar_m(bim)
    print("OK" if total == 0 else f"{total} problema(s)")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
