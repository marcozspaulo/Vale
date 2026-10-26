"""Gera o projeto do Power BI (.pbip) do painel de obras de implantação.

O projeto tem o modelo semântico (model.bim) e o relatório no formato PBIR, com três
páginas: Visão geral, Prazos e documentação, Lista de obras. Abre no Power BI Desktop e
pode ser publicado no serviço; os dados vêm da planilha no SharePoint.

Uso:
    python3 powerbi/gerar_pbip.py --saida dist/pbip \
        --site https://<empresa>.sharepoint.com/sites/<site> \
        --arquivo "CONTROLE OBRAS IMPLANTAÇÃO 2026 - QUALIDADE.xlsx"
"""

import argparse
import json
import shutil
import uuid
from pathlib import Path

NOME = "Painel Obras Implantacao 2026"
NS = uuid.UUID("6f1c3a52-4c1e-4a57-9a0e-2f6b0d6f2a10")

SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/"
S_PBIP = SCHEMA + "pbip/pbipProperties/1.0.0/schema.json"
S_PLATFORM = SCHEMA + "gitIntegration/platformProperties/2.0.0/schema.json"
S_PBISM = SCHEMA + "item/semanticModel/definitionProperties/1.0.0/schema.json"
S_PBIR = SCHEMA + "item/report/definitionProperties/2.0.0/schema.json"
S_VERSION = SCHEMA + "item/report/definition/versionMetadata/1.0.0/schema.json"
S_REPORT = SCHEMA + "item/report/definition/report/2.1.0/schema.json"
S_PAGES = SCHEMA + "item/report/definition/pagesMetadata/1.0.0/schema.json"
S_PAGE = SCHEMA + "item/report/definition/page/2.0.0/schema.json"
S_VISUAL = SCHEMA + "item/report/definition/visualContainer/2.1.0/schema.json"

# Cores (guia de marca Vale + cores funcionais do painel HTML)
VERDE, VERDE_ESCURO, AMARELO = "#007E7A", "#034944", "#ECB11F"
TEXTO, CINZA_CLARO, BRANCO = "#555555", "#E6E7E8", "#FFFFFF"
SERIE = "#00948D"
EMERG = {"Sim": "#B42318", "Não": "#2FB05A", "Não informado": "#BCBEC0"}
STATUS = {"A iniciar": "#0ABB98", "Em execução": "#00948D", "Concluída": "#034944"}
DOC = {"Aprovada": "#034944", "Em andamento": "#00948D", "Pendente": "#E0A619", "Sem registro": "#BCBEC0"}
FONTE = "Arial"

SITES = [
    # SiteId, Site, Município, Latitude, Longitude, Ordem (coordenadas aproximadas)
    ("fabrica", "Fábrica", "Ouro Preto", -20.4135, -43.8814, 1),
    ("viga", "Viga", "Congonhas", -20.455, -43.835, 2),
    ("feijao", "Córrego do Feijão", "Brumadinho", -20.129, -44.110, 3),
    ("cpx", "Capão Xavier", "Nova Lima", -20.046, -43.985, 4),
    ("marazul", "Mar Azul", "Nova Lima", -20.115, -43.970, 5),
    ("mutuca", "Mutuca", "Nova Lima", -20.030, -43.968, 6),
]
APELIDOS = [
    ("MUTUCA", "mutuca"), ("MINA DE MUTUCA", "mutuca"),
    ("CPX", "cpx"), ("CAPÃO XAVIER", "cpx"), ("CAPAO XAVIER", "cpx"),
    ("MAR AZUL", "marazul"), ("MINA MAR AZUL", "marazul"),
    ("FEIJÃO", "feijao"), ("FEIJAO", "feijao"), ("CÓRREGO DO FEIJÃO", "feijao"), ("CORREGO DO FEIJAO", "feijao"),
    ("FÁBRICA", "fabrica"), ("FABRICA", "fabrica"), ("MINA DE FÁBRICA", "fabrica"),
    ("VIGA", "viga"), ("MINA DE VIGA", "viga"),
]


def tag(*partes):
    """GUID estável a partir de um nome, para o projeto não mudar a cada geração."""
    return str(uuid.uuid5(NS, "/".join(partes)))


def m_texto(s):
    return '"' + s.replace('"', '""') + '"'


# =====================================================================================
# Power Query (M)
# =====================================================================================

def m_sites():
    linhas = ",\n".join(
        f"            {{{m_texto(i)}, {m_texto(n)}, {m_texto(mu)}, {la}, {lo}, {o}}}"
        for i, n, mu, la, lo, o in SITES)
    return f"""let
    Sites = #table(
        type table [SiteId = text, Site = text, Município = text, Latitude = number, Longitude = number, Ordem = Int64.Type],
        {{
{linhas}
        }})
in
    Sites"""


def m_obras():
    apelidos = ", ".join(f"{{{m_texto(a)}, {m_texto(i)}}}" for a, i in APELIDOS)
    return f"""let
    // Procura a planilha pelo nome em todo o site do SharePoint (não depende da pasta).
    Arquivos = SharePoint.Files(SiteSharePoint, [ApiVersion = 15]),
    Encontrados = Table.SelectRows(Arquivos, each Comparer.Equals(Comparer.OrdinalIgnoreCase, [Name], NomeArquivo)),
    MaisRecente = Table.Sort(Encontrados, {{{{"Date modified", Order.Descending}}}}),
    Conteudo =
        if Table.IsEmpty(MaisRecente)
        then error Error.Record("Planilha não encontrada", "Confira os parâmetros SiteSharePoint e NomeArquivo.")
        else MaisRecente{{0}}[Content],
    Origem = Excel.Workbook(Conteudo, null, true),
    // Abas de dados. Cópias como "PARAOPEBA SUL (2)" ficam de fora.
    Abas = Table.SelectRows(Origem, each [Kind] = "Sheet" and not Text.Contains([Name], "(")),

    Texto = (v) => Text.Trim(Text.Clean(Text.From(v ?? ""))),

    // Cada aba tem um título (ex.: PARAOPEBA NORTE) acima do cabeçalho que começa em "TAP".
    LerAba = (dados as table, nomeAba as text) as table =>
        let
            Linhas = Table.ToRows(dados),
            PrimeiraColuna = List.Transform(Linhas, each Text.Upper(Texto(_{{0}}))),
            IdxCab = List.PositionOf(PrimeiraColuna, "TAP"),
            Titulos = if IdxCab <= 0 then {{}} else List.Select(List.FirstN(PrimeiraColuna, IdxCab), each _ <> ""),
            Regional = Text.Proper(if List.IsEmpty(Titulos) then nomeAba else List.First(Titulos)),
            CabBruto = if IdxCab < 0 then {{}} else List.Transform(Linhas{{IdxCab}}, Texto),
            Cabecalho = List.Transform(List.Positions(CabBruto), (i) => if CabBruto{{i}} = "" then "Coluna" & Text.From(i + 1) else CabBruto{{i}}),
            Tabela = if IdxCab < 0 then #table({{}}, {{}}) else Table.FromRows(List.Skip(Linhas, IdxCab + 1), Cabecalho)
        in
            Table.AddColumn(Tabela, "Regional", each Regional, type text),

    Combinado = Table.Combine(List.Transform(Table.ToRecords(Abas), each LerAba([Data], [Name]))),
    Renomeado = Table.RenameColumns(Combinado,
        {{{{"Gestor Vale", "Gestor"}}, {{"Dta Conclusão", "DataConclusao"}}, {{"Emergencial?", "Emergencial"}}, {{"OBSERVAÇÕES", "Observacoes"}}}},
        MissingField.Ignore),
    Selecionado = Table.SelectColumns(Renomeado,
        {{"Regional", "TAP", "Projeto", "Empresa", "Gestor", "Site", "DataConclusao", "Status", "Emergencial", "Observacoes"}},
        MissingField.UseNull),
    SemVazias = Table.SelectRows(Selecionado, each Texto([TAP]) <> "" or Texto([Projeto]) <> ""),

    // "EXEMPLO ENGENHARIA LTDA" -> "Exemplo"
    Sufixos = {{" LTDA", " S A", " S/A", " S.A.", " ENGENHARIA E CONSTRUCOES", " ENGENHARIA E CONSTRUÇÕES",
               " PROJETOS E CONSTRUCOES", " PROJETOS E CONSTRUÇÕES", " ENGENHARIA"}},
    EmpresaCurta = (t as text) as text =>
        let u = Text.Upper(t)
        in if u = "" or Text.StartsWith(u, "NÃO DEFIN") or Text.StartsWith(u, "NAO DEFIN") then "Não definida"
           else Text.Proper(List.Accumulate(Sufixos, u, (s, x) => if Text.EndsWith(s, x) then Text.Start(s, Text.Length(s) - Text.Length(x)) else s)),

    Tratado = Table.TransformColumns(SemVazias, {{
        {{"TAP", Texto, type text}},
        {{"Projeto", each
            let p = Text.Trim(Text.Replace(Texto(_), "**", "")) in
            if Text.Length(p) > 110 or Text.Contains(Text.Lower(p), "sobre mim") then "Descrição a revisar na base" else p, type text}},
        {{"Empresa", each EmpresaCurta(Texto(_)), type text}},
        {{"Gestor", each Text.Proper(Texto(_)), type text}},
        {{"Site", each Text.Upper(Texto(_)), type text}},
        {{"Status", each
            let t = Text.Lower(Texto(_)) in
            if Text.StartsWith(t, "conclu") then "Concluída"
            else if Text.StartsWith(t, "em exec") then "Em execução"
            else if Text.StartsWith(t, "a iniciar") then "A iniciar"
            else if t = "" then "Não informado"
            else Text.Proper(t), type text}},
        {{"Emergencial", each
            let t = Text.Upper(Texto(_)) in
            if t = "SIM" then "Sim" else if t = "NÃO" or t = "NAO" then "Não" else "Não informado", type text}},
        {{"Observacoes", each let t = Texto(_) in if Text.Upper(Text.Remove(t, " ")) = "SEMSTATUS" then "" else t, type text}},
        {{"DataConclusao", each try Date.From(_) otherwise null, type nullable date}}
    }}),

    // Situação documental (SIT / NAP / As Built / Data Book) lida do texto de Observações.
    ComDoc = Table.AddColumn(Tratado, "SituacaoDocumental", each
        let
            t = Text.Lower([Observacoes]),
            Tem = (lista as list) => List.AnyTrue(List.Transform(lista, (k) => Text.Contains(t, k)))
        in
            if t = "" then "Sem registro"
            else if Tem({{"pendente", "pendência", "não tem numera", "solicitou número", "subir revis", "repostagem", "fazer altera", "aguardando"}}) then "Pendente"
            else if Tem({{"aprovad", "entregue", "finalizad"}}) then "Aprovada"
            else "Em andamento", type text),

    // Grafias aceitas na coluna Site (MAIÚSCULAS). Site novo: acrescente aqui e na tabela Sites.
    Apelidos = #table(type table [Chave = text, SiteId = text], {{{apelidos}}}),
    ComApelido = Table.NestedJoin(ComDoc, {{"Site"}}, Apelidos, {{"Chave"}}, "Apelido", JoinKind.LeftOuter),
    Expandido = Table.ExpandTableColumn(ComApelido, "Apelido", {{"SiteId"}}, {{"SiteCadastro"}}),
    ComSiteId = Table.AddColumn(Expandido, "SiteId", each [SiteCadastro] ?? ("sem cadastro: " & [Site]), type text),
    ComOrdemStatus = Table.AddColumn(ComSiteId, "OrdemStatus", each
        if [Status] = "A iniciar" then 1 else if [Status] = "Em execução" then 2 else if [Status] = "Concluída" then 3 else 4, Int64.Type),
    ComOrdemDoc = Table.AddColumn(ComOrdemStatus, "OrdemDocumental", each
        if [SituacaoDocumental] = "Aprovada" then 1 else if [SituacaoDocumental] = "Em andamento" then 2
        else if [SituacaoDocumental] = "Pendente" then 3 else 4, Int64.Type),
    Resultado = Table.RenameColumns(Table.RemoveColumns(ComOrdemDoc, {{"SiteCadastro"}}), {{
        {{"Gestor", "Gestor Vale"}}, {{"Site", "Site na planilha"}}, {{"DataConclusao", "Data de conclusão"}},
        {{"Observacoes", "Observações"}}, {{"SituacaoDocumental", "Situação documental"}},
        {{"OrdemStatus", "Ordem status"}}, {{"OrdemDocumental", "Ordem documental"}}}})
in
    Resultado"""


def m_parametro(valor):
    return f'{m_texto(valor)} meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]'


# =====================================================================================
# Modelo semântico (TMSL / model.bim)
# =====================================================================================

def coluna(tabela, nome, tipo, origem=None, oculta=False, formato=None, categoria=None,
           ordenar_por=None, expressao=None, pasta=None):
    c = {"name": nome, "dataType": tipo}
    if expressao:
        c["type"] = "calculated"
        c["isDataTypeInferred"] = True
        c["expression"] = expressao.strip().split("\n")
    else:
        c["sourceColumn"] = origem or nome
    if oculta:
        c["isHidden"] = True
    if formato:
        c["formatString"] = formato
    if categoria:
        c["dataCategory"] = categoria
    if ordenar_por:
        c["sortByColumn"] = ordenar_por
    if pasta:
        c["displayFolder"] = pasta
    c["lineageTag"] = tag("coluna", tabela, nome)
    c["summarizeBy"] = "none"
    anot = [{"name": "SummarizationSetBy", "value": "Automatic"}]
    if tipo == "dateTime":
        anot.append({"name": "UnderlyingDateTimeDataType", "value": "Date"})
    c["annotations"] = anot
    return c


def medida(nome, expressao, formato="0", pasta="Indicadores"):
    return {"name": nome, "expression": expressao.strip().split("\n"), "formatString": formato,
            "displayFolder": pasta, "lineageTag": tag("medida", nome)}


FAIXA_PRAZO = """
VAR d = Obras[Data de conclusão]
RETURN
    SWITCH (
        TRUE (),
        Obras[Status] = "Concluída", "Concluída",
        ISBLANK ( d ), "Sem data",
        d < TODAY (), "Atrasada",
        d <= TODAY () + 30, "Vence em até 30 dias",
        "No prazo"
    )"""
ORDEM_PRAZO = """
VAR d = Obras[Data de conclusão]
RETURN
    SWITCH (
        TRUE (),
        Obras[Status] = "Concluída", 5,
        ISBLANK ( d ), 4,
        d < TODAY (), 1,
        d <= TODAY () + 30, 2,
        3
    )"""
DIAS_ATRASO = """
IF (
    Obras[Status] <> "Concluída" && NOT ISBLANK ( Obras[Data de conclusão] ) && Obras[Data de conclusão] < TODAY (),
    DATEDIFF ( Obras[Data de conclusão], TODAY (), DAY )
)"""
DIAS_CONCLUIR = """
IF (
    Obras[Status] <> "Concluída" && NOT ISBLANK ( Obras[Data de conclusão] ) && Obras[Data de conclusão] >= TODAY (),
    DATEDIFF ( TODAY (), Obras[Data de conclusão], DAY )
)"""
DIAS_PENDENCIA = """
IF (
    Obras[Status] = "Concluída" && Obras[Situação documental] <> "Aprovada"
        && NOT ISBLANK ( Obras[Data de conclusão] ) && Obras[Data de conclusão] <= TODAY (),
    DATEDIFF ( Obras[Data de conclusão], TODAY (), DAY )
)"""
MES = """
IF ( NOT ISBLANK ( Obras[Data de conclusão] ), FORMAT ( Obras[Data de conclusão], "mmm/yy" ) )"""
ORDEM_MES = """
IF ( NOT ISBLANK ( Obras[Data de conclusão] ), YEAR ( Obras[Data de conclusão] ) * 100 + MONTH ( Obras[Data de conclusão] ) )"""

MEDIDAS = [
    ("Qtd Obras", "COUNTROWS ( Obras )", "0"),
    ("Total de obras", "COUNTROWS ( Obras ) + 0", "0"),
    ("Emergenciais", 'CALCULATE ( COUNTROWS ( Obras ), Obras[Emergencial] = "Sim" ) + 0', "0"),
    ("Não emergenciais", 'CALCULATE ( COUNTROWS ( Obras ), Obras[Emergencial] = "Não" ) + 0', "0"),
    ("Emergenciais em aberto",
     'CALCULATE ( COUNTROWS ( Obras ), Obras[Emergencial] = "Sim", Obras[Status] <> "Concluída" ) + 0', "0"),
    ("Atrasadas", 'CALCULATE ( COUNTROWS ( Obras ), Obras[Faixa de prazo] = "Atrasada" ) + 0', "0"),
    ("Vencem em 30 dias", 'CALCULATE ( COUNTROWS ( Obras ), Obras[Faixa de prazo] = "Vence em até 30 dias" ) + 0', "0"),
    ("Concluídas", 'CALCULATE ( COUNTROWS ( Obras ), Obras[Status] = "Concluída" )', "0"),
    ("Concluídas sem doc. aprovada",
     'CALCULATE ( COUNTROWS ( Obras ), Obras[Status] = "Concluída", Obras[Situação documental] <> "Aprovada" ) + 0', "0"),
    ("% doc. aprovada", """
DIVIDE (
    [Concluídas] - CALCULATE ( COUNTROWS ( Obras ), Obras[Status] = "Concluída", Obras[Situação documental] <> "Aprovada" ),
    [Concluídas]
)""", "0%"),
    ("Prazo", """
VAR f = SELECTEDVALUE ( Obras[Faixa de prazo] )
VAR atraso = MAX ( Obras[Dias de atraso] )
VAR faltam = MAX ( Obras[Dias para concluir] )
RETURN
    SWITCH (
        f,
        "Atrasada", FORMAT ( atraso, "0" ) & " dias de atraso",
        "Vence em até 30 dias", IF ( faltam = 0, "vence hoje", "vence em " & FORMAT ( faltam, "0" ) & " dias" )
    )""", None),
    ("Dias sem doc. aprovada", "MAX ( Obras[Dias com pendência documental] )", "0"),
]


def modelo(site, arquivo):
    obras_cols = [
        coluna("Obras", "Regional", "string"),
        coluna("Obras", "TAP", "string"),
        coluna("Obras", "Projeto", "string"),
        coluna("Obras", "Empresa", "string"),
        coluna("Obras", "Gestor Vale", "string"),
        coluna("Obras", "Site na planilha", "string"),
        coluna("Obras", "Data de conclusão", "dateTime", formato="dd/mm/yyyy"),
        coluna("Obras", "Status", "string", ordenar_por="Ordem status"),
        coluna("Obras", "Emergencial", "string"),
        coluna("Obras", "Observações", "string"),
        coluna("Obras", "Situação documental", "string", ordenar_por="Ordem documental"),
        coluna("Obras", "SiteId", "string", oculta=True),
        coluna("Obras", "Ordem status", "int64", oculta=True),
        coluna("Obras", "Ordem documental", "int64", oculta=True),
        coluna("Obras", "Faixa de prazo", "string", expressao=FAIXA_PRAZO, ordenar_por="Ordem prazo"),
        coluna("Obras", "Ordem prazo", "int64", expressao=ORDEM_PRAZO, oculta=True),
        coluna("Obras", "Dias de atraso", "int64", expressao=DIAS_ATRASO, formato="0"),
        coluna("Obras", "Dias para concluir", "int64", expressao=DIAS_CONCLUIR, formato="0"),
        coluna("Obras", "Dias com pendência documental", "int64", expressao=DIAS_PENDENCIA, formato="0"),
        coluna("Obras", "Mês de conclusão", "string", expressao=MES, ordenar_por="Ordem mês"),
        coluna("Obras", "Ordem mês", "int64", expressao=ORDEM_MES, oculta=True),
    ]
    sites_cols = [
        coluna("Sites", "SiteId", "string", oculta=True),
        coluna("Sites", "Site", "string", ordenar_por="Ordem"),
        coluna("Sites", "Município", "string", categoria="City"),
        coluna("Sites", "Latitude", "double", categoria="Latitude", formato="0.0000"),
        coluna("Sites", "Longitude", "double", categoria="Longitude", formato="0.0000"),
        coluna("Sites", "Ordem", "int64", oculta=True),
    ]
    tabelas = [
        {
            "name": "Obras",
            "lineageTag": tag("tabela", "Obras"),
            "columns": obras_cols,
            "partitions": [{"name": "Obras", "mode": "import",
                            "source": {"type": "m", "expression": m_obras().split("\n")}}],
            "measures": [medida(n, e, f) for n, e, f in MEDIDAS],
            "annotations": [{"name": "PBI_ResultType", "value": "Table"}],
        },
        {
            "name": "Sites",
            "lineageTag": tag("tabela", "Sites"),
            "columns": sites_cols,
            "partitions": [{"name": "Sites", "mode": "import",
                            "source": {"type": "m", "expression": m_sites().split("\n")}}],
            "annotations": [{"name": "PBI_ResultType", "value": "Table"}],
        },
    ]
    for t in tabelas:
        for m in t.get("measures", []):
            if m["formatString"] is None:
                del m["formatString"]
    return {
        "compatibilityLevel": 1550,
        "model": {
            "culture": "pt-BR",
            "dataAccessOptions": {"legacyRedirects": True, "returnErrorValuesAsNull": True},
            "defaultPowerBIDataSourceVersion": "powerBI_V3",
            "sourceQueryCulture": "pt-BR",
            "tables": tabelas,
            "relationships": [{
                "name": tag("relacao", "Obras.SiteId", "Sites.SiteId"),
                "fromTable": "Obras", "fromColumn": "SiteId", "toTable": "Sites", "toColumn": "SiteId",
            }],
            "expressions": [
                {"name": "SiteSharePoint", "kind": "m", "expression": m_parametro(site),
                 "lineageTag": tag("parametro", "SiteSharePoint"),
                 "annotations": [{"name": "PBI_ResultType", "value": "Text"}]},
                {"name": "NomeArquivo", "kind": "m", "expression": m_parametro(arquivo),
                 "lineageTag": tag("parametro", "NomeArquivo"),
                 "annotations": [{"name": "PBI_ResultType", "value": "Text"}]},
            ],
            "annotations": [
                {"name": "__PBI_TimeIntelligenceEnabled", "value": "0"},
                {"name": "PBI_QueryOrder", "value": json.dumps(["SiteSharePoint", "NomeArquivo", "Sites", "Obras"])},
            ],
        },
    }


# =====================================================================================
# Relatório (PBIR)
# =====================================================================================

def col(tabela, nome):
    return {"Column": {"Expression": {"SourceRef": {"Entity": tabela}}, "Property": nome}}


def med(nome, tabela="Obras"):
    return {"Measure": {"Expression": {"SourceRef": {"Entity": tabela}}, "Property": nome}}


def proj(campo, ativo=None, nome=None):
    tipo = "Column" if "Column" in campo else "Measure"
    tabela = campo[tipo]["Expression"]["SourceRef"]["Entity"]
    prop = campo[tipo]["Property"]
    p = {"field": campo, "queryRef": f"{tabela}.{prop}", "nativeQueryRef": prop}
    if nome:
        p["displayName"] = nome
    if ativo:
        p["active"] = True
    return p


def lit(valor):
    return {"expr": {"Literal": {"Value": valor}}}


def txt(s):
    return lit("'" + s.replace("'", "''") + "'")


def num(n):
    return lit(f"{n}D")


def booleano(b):
    return lit("true" if b else "false")


def cor(hexa):
    return {"solid": {"color": txt(hexa)}}


def cores_por_valor(tabela, coluna_, mapa):
    return [{
        "properties": {"fill": cor(c)},
        "selector": {"data": [{"scopeId": {"Comparison": {
            "ComparisonKind": 0, "Left": col(tabela, coluna_),
            "Right": {"Literal": {"Value": "'" + v + "'"}}}}}]},
    } for v, c in mapa.items()]


def moldura(titulo=None, fundo=BRANCO, borda=True):
    vco = {
        "background": [{"properties": {"show": booleano(True), "color": cor(fundo), "transparency": num(0)}}],
        "border": [{"properties": {"show": booleano(borda), "color": cor(CINZA_CLARO), "radius": num(8)}}],
        "dropShadow": [{"properties": {"show": booleano(False)}}],
    }
    if titulo:
        vco["title"] = [{"properties": {
            "show": booleano(True), "text": txt(titulo), "fontColor": cor(VERDE),
            "fontSize": num(12), "bold": booleano(True), "fontFamily": txt(FONTE)}}]
    else:
        vco["title"] = [{"properties": {"show": booleano(False)}}]
    return vco


class Pagina:
    def __init__(self, nome, titulo):
        self.nome, self.titulo, self.visuais = nome, titulo, []

    def add(self, nome, x, y, w, h, tipo, consulta=None, objetos=None, vco=None, sync=None):
        v = {"visualType": tipo}
        if consulta:
            v["query"] = consulta
        if objetos:
            v["objects"] = objetos
        if vco:
            v["visualContainerObjects"] = vco
        if sync:
            v["syncGroup"] = {"groupName": sync, "fieldChanges": True, "filterChanges": True}
        v["drillFilterOtherVisuals"] = True
        self.visuais.append({
            "$schema": S_VISUAL, "name": nome,
            "position": {"x": x, "y": y, "z": len(self.visuais) * 1000, "height": h, "width": w,
                         "tabOrder": len(self.visuais) * 1000},
            "visual": v,
        })


def consulta(papeis, ordenar=None):
    q = {"queryState": {papel: {"projections": projs} for papel, projs in papeis.items()}}
    if ordenar:
        q["sortDefinition"] = {"sort": [{"field": c, "direction": d} for c, d in ordenar], "isDefaultSort": False}
    return q


def cabecalho(p, subtitulo):
    p.add("titulo", 0, 0, 1280, 56, "textbox", objetos={"general": [{"properties": {"paragraphs": [
        {"textRuns": [{"value": "Obras de implantação 2026",
                       "textStyle": {"fontFamily": FONTE, "fontSize": "18pt", "fontWeight": "bold", "color": BRANCO}}]},
        {"textRuns": [{"value": subtitulo,
                       "textStyle": {"fontFamily": FONTE, "fontSize": "10pt", "color": BRANCO}}]},
    ]}}]}, vco=moldura(fundo=VERDE, borda=False))
    p.add("faixa_amarela", 0, 56, 1280, 4, "shape", objetos={
        "shape": [{"properties": {"tileShape": txt("rectangle")}}],
        "fill": [{"properties": {"show": booleano(False)}}],
        "outline": [{"properties": {"show": booleano(False)}}],
    }, vco=moldura(fundo=AMARELO, borda=False))
    filtros = [
        ("seg_regional", col("Obras", "Regional"), "Regional"),
        ("seg_status", col("Obras", "Status"), "Status"),
        ("seg_emergencial", col("Obras", "Emergencial"), "Emergencial"),
        ("seg_prazo", col("Obras", "Faixa de prazo"), "FaixaPrazo"),
        ("seg_gestor", col("Obras", "Gestor Vale"), "Gestor"),
        ("seg_empresa", col("Obras", "Empresa"), "Empresa"),
    ]
    largura = (1280 - 32 - 5 * 8) / 6
    for i, (nome, campo, grupo) in enumerate(filtros):
        p.add(nome, round(16 + i * (largura + 8), 2), 68, round(largura, 2), 56, "slicer",
              consulta=consulta({"Values": [proj(campo, ativo=True)]}),
              objetos={
                  "data": [{"properties": {"mode": txt("Dropdown")}}],
                  "header": [{"properties": {"show": booleano(True), "fontColor": cor(TEXTO),
                                             "textSize": num(9), "fontFamily": txt(FONTE)}}],
              },
              vco=moldura(), sync=grupo)


def pagina_visao_geral():
    p = Pagina("visao_geral", "Visão geral")
    cabecalho(p, "Controle de qualidade · Complexo Paraopeba · Visão geral")
    cards = ["Total de obras", "Emergenciais", "Atrasadas", "Vencem em 30 dias", "Concluídas sem doc. aprovada"]
    largura = (1280 - 32 - 4 * 8) / 5
    for i, m in enumerate(cards):
        p.add(f"kpi_{i + 1}", round(16 + i * (largura + 8), 2), 132, round(largura, 2), 88, "card",
              consulta=consulta({"Values": [proj(med(m))]}),
              objetos={
                  "labels": [{"properties": {"color": cor(VERDE), "fontSize": num(26), "fontFamily": txt(FONTE)}}],
                  "categoryLabels": [{"properties": {"show": booleano(True), "color": cor(TEXTO),
                                                     "fontSize": num(10), "fontFamily": txt(FONTE)}}],
              },
              vco=moldura())
    p.add("mapa_sites", 16, 228, 760, 476, "azureMap",
          consulta=consulta({
              "Category": [proj(col("Sites", "Site"), ativo=True)],
              "Series": [proj(col("Obras", "Emergencial"))],
              "Size": [proj(med("Qtd Obras"))],
              "Y": [proj(col("Sites", "Latitude"))],
              "X": [proj(col("Sites", "Longitude"))],
              "Tooltips": [proj(med("Emergenciais")), proj(med("Não emergenciais")), proj(med("Atrasadas"))],
          }),
          objetos={"dataPoint": cores_por_valor("Obras", "Emergencial", EMERG)},
          vco=moldura("Mapa de obras por site · tamanho = nº de obras · vermelho = emergencial"))
    p.add("obras_por_site", 784, 228, 480, 220, "barChart",
          consulta=consulta({
              "Category": [proj(col("Sites", "Site"), ativo=True)],
              "Series": [proj(col("Obras", "Status"))],
              "Y": [proj(med("Qtd Obras"))],
          }, ordenar=[(med("Qtd Obras"), "Descending")]),
          objetos={"dataPoint": cores_por_valor("Obras", "Status", STATUS),
                   "labels": [{"properties": {"show": booleano(True)}}]},
          vco=moldura("Obras por site e status"))
    p.add("radar_prazos", 784, 456, 480, 248, "tableEx",
          consulta=consulta({"Values": [
              proj(col("Obras", "TAP")), proj(col("Obras", "Projeto")), proj(col("Sites", "Site")),
              proj(col("Obras", "Emergencial")), proj(col("Obras", "Data de conclusão")), proj(med("Prazo")),
          ]}, ordenar=[(col("Obras", "Data de conclusão"), "Ascending")]),
          objetos={"total": [{"properties": {"totals": booleano(False)}}]},
          vco=moldura("Radar de prazos · atrasadas e vencendo em 30 dias"))
    return p


def pagina_prazos_documentacao():
    p = Pagina("prazos_documentacao", "Prazos e documentação")
    cabecalho(p, "Controle de qualidade · Complexo Paraopeba · Prazos e documentação")
    p.add("conclusoes_por_mes", 16, 132, 624, 280, "columnChart",
          consulta=consulta({
              "Category": [proj(col("Obras", "Mês de conclusão"), ativo=True)],
              "Series": [proj(col("Obras", "Emergencial"))],
              "Y": [proj(med("Qtd Obras"))],
          }, ordenar=[(col("Obras", "Mês de conclusão"), "Ascending")]),
          objetos={"dataPoint": cores_por_valor("Obras", "Emergencial", EMERG)},
          vco=moldura("Conclusões previstas e realizadas por mês"))
    p.add("fechamento_documental", 648, 132, 616, 280, "barChart",
          consulta=consulta({
              "Category": [proj(col("Sites", "Site"), ativo=True)],
              "Series": [proj(col("Obras", "Situação documental"))],
              "Y": [proj(med("Concluídas"))],
          }, ordenar=[(med("Concluídas"), "Descending")]),
          objetos={"dataPoint": cores_por_valor("Obras", "Situação documental", DOC),
                   "labels": [{"properties": {"show": booleano(True)}}]},
          vco=moldura("Fechamento documental das obras concluídas (SIT, NAP, As Built, Data Book)"))
    p.add("pendencias_antigas", 16, 420, 624, 284, "tableEx",
          consulta=consulta({"Values": [
              proj(col("Obras", "TAP")), proj(col("Obras", "Projeto")), proj(col("Sites", "Site")),
              proj(col("Obras", "Data de conclusão")), proj(col("Obras", "Situação documental")),
              proj(med("Dias sem doc. aprovada")),
          ]}, ordenar=[(col("Obras", "Data de conclusão"), "Ascending")]),
          objetos={"total": [{"properties": {"totals": booleano(False)}}]},
          vco=moldura("Concluídas há mais tempo sem documentação aprovada"))
    p.add("obras_por_empresa", 648, 420, 304, 284, "clusteredBarChart",
          consulta=consulta({
              "Category": [proj(col("Obras", "Empresa"), ativo=True)],
              "Y": [proj(med("Qtd Obras"))],
          }, ordenar=[(med("Qtd Obras"), "Descending")]),
          objetos={"dataPoint": [{"properties": {"fill": cor(SERIE)}}],
                   "labels": [{"properties": {"show": booleano(True)}}]},
          vco=moldura("Obras por contratada"))
    p.add("obras_por_gestor", 960, 420, 304, 284, "clusteredBarChart",
          consulta=consulta({
              "Category": [proj(col("Obras", "Gestor Vale"), ativo=True)],
              "Y": [proj(med("Qtd Obras"))],
          }, ordenar=[(med("Qtd Obras"), "Descending")]),
          objetos={"dataPoint": [{"properties": {"fill": cor(SERIE)}}],
                   "labels": [{"properties": {"show": booleano(True)}}]},
          vco=moldura("Obras por gestor Vale"))
    return p


def pagina_lista():
    p = Pagina("lista_obras", "Lista de obras")
    cabecalho(p, "Controle de qualidade · Complexo Paraopeba · Lista de obras")
    campos = [col("Obras", c) for c in ("Regional", "TAP", "Projeto")] + [col("Sites", "Site")] + [
        col("Obras", c) for c in ("Empresa", "Gestor Vale", "Data de conclusão", "Faixa de prazo", "Status",
                                  "Emergencial", "Situação documental", "Observações")]
    p.add("lista", 16, 132, 1248, 572, "tableEx",
          consulta=consulta({"Values": [proj(c) for c in campos]},
                            ordenar=[(col("Obras", "Data de conclusão"), "Ascending")]),
          vco=moldura("Lista de obras"))
    return p


def tema_vale():
    return {
        "name": "Vale",
        "dataColors": ["#00948D", "#E0A619", "#0ABB98", "#C0305E", "#3CB5E5", "#EE6F16", "#034944", "#9DE4D6"],
        "background": BRANCO,
        "backgroundLight": CINZA_CLARO,
        "foreground": VERDE,
        "foregroundNeutralSecondary": TEXTO,
        "tableAccent": VERDE,
        "good": "#2FB05A",
        "neutral": "#E0A619",
        "bad": "#B42318",
        "minimum": "#9DE4D6",
        "center": "#00948D",
        "maximum": "#034944",
        "textClasses": {
            "callout": {"fontFace": FONTE, "color": VERDE, "fontSize": 28},
            "title": {"fontFace": FONTE, "color": VERDE, "fontSize": 12},
            "header": {"fontFace": FONTE, "color": VERDE, "fontSize": 12},
            "label": {"fontFace": FONTE, "color": TEXTO, "fontSize": 10},
        },
    }


def escrever(caminho, dados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def gerar(saida, site, arquivo):
    raiz = Path(saida)
    if raiz.exists():
        shutil.rmtree(raiz)
    relatorio = raiz / f"{NOME}.Report"
    semantico = raiz / f"{NOME}.SemanticModel"

    escrever(raiz / f"{NOME}.pbip", {
        "$schema": S_PBIP, "version": "1.0",
        "artifacts": [{"report": {"path": f"{NOME}.Report"}}],
        "settings": {"enableAutoRecovery": True},
    })

    # modelo semântico
    escrever(semantico / ".platform", {
        "$schema": S_PLATFORM,
        "metadata": {"type": "SemanticModel", "displayName": NOME},
        "config": {"version": "2.0", "logicalId": tag("item", "semanticModel")},
    })
    escrever(semantico / "definition.pbism", {"$schema": S_PBISM, "version": "4.0", "settings": {}})
    escrever(semantico / "model.bim", modelo(site, arquivo))

    # relatório
    escrever(relatorio / ".platform", {
        "$schema": S_PLATFORM,
        "metadata": {"type": "Report", "displayName": NOME},
        "config": {"version": "2.0", "logicalId": tag("item", "report")},
    })
    escrever(relatorio / "definition.pbir", {
        "$schema": S_PBIR, "version": "4.0",
        "datasetReference": {"byPath": {"path": f"../{NOME}.SemanticModel"}},
    })
    escrever(relatorio / "definition" / "version.json", {"$schema": S_VERSION, "version": "2.0.0"})
    tema = tema_vale()
    base = dict(tema, name="CY24SU10")
    escrever(relatorio / "StaticResources" / "SharedResources" / "BaseThemes" / "CY24SU10.json", base)
    escrever(relatorio / "StaticResources" / "RegisteredResources" / "TemaVale.json", tema)
    escrever(relatorio / "definition" / "report.json", {
        "$schema": S_REPORT,
        "themeCollection": {
            "baseTheme": {"name": "CY24SU10", "reportVersionAtImport": "5.61", "type": "SharedResources"},
            "customTheme": {"name": "TemaVale.json", "reportVersionAtImport": "5.61", "type": "RegisteredResources"},
        },
        "objects": {"section": [{"properties": {"verticalAlignment": txt("Top")}}]},
        "resourcePackages": [
            {"name": "SharedResources", "type": "SharedResources",
             "items": [{"name": "CY24SU10", "path": "BaseThemes/CY24SU10.json", "type": "BaseTheme"}]},
            {"name": "RegisteredResources", "type": "RegisteredResources",
             "items": [{"name": "TemaVale.json", "path": "TemaVale.json", "type": "CustomTheme"}]},
        ],
        "settings": {
            "useStylableVisualContainerHeader": True,
            "defaultDrillFilterOtherVisuals": True,
            "allowChangeFilterTypes": True,
            "useEnhancedTooltips": True,
            "useDefaultAggregateDisplayName": True,
        },
    })
    paginas = [pagina_visao_geral(), pagina_prazos_documentacao(), pagina_lista()]
    escrever(relatorio / "definition" / "pages" / "pages.json", {
        "$schema": S_PAGES, "pageOrder": [p.nome for p in paginas], "activePageName": paginas[0].nome,
    })
    for p in paginas:
        pasta = relatorio / "definition" / "pages" / p.nome
        escrever(pasta / "page.json", {
            "$schema": S_PAGE, "name": p.nome, "displayName": p.titulo,
            "displayOption": "FitToPage", "height": 720, "width": 1280,
            "objects": {"background": [{"properties": {"color": cor(BRANCO), "transparency": num(0)}}]},
        })
        for v in p.visuais:
            escrever(pasta / "visuals" / v["name"] / "visual.json", v)
    return raiz


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", required=True, help="pasta onde o projeto será criado (é recriada)")
    ap.add_argument("--site", default="https://empresa.sharepoint.com/sites/SEU-SITE",
                    help="endereço do site do SharePoint onde está a planilha")
    ap.add_argument("--arquivo", default="CONTROLE OBRAS IMPLANTAÇÃO 2026 - QUALIDADE.xlsx",
                    help="nome exato do arquivo .xlsx no SharePoint")
    a = ap.parse_args()
    raiz = gerar(a.saida, a.site, a.arquivo)
    print(f"Projeto gerado em {raiz}")


if __name__ == "__main__":
    main()
