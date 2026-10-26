// =====================================================================================
// Consultas do Power Query para o painel de obras (cole cada bloco em Página Inicial >
// Transformar dados > Nova fonte > Consulta nula > Editor avançado, com o nome indicado).
// =====================================================================================


// ---------- Parâmetro: UrlPlanilha (Gerenciar parâmetros > Novo parâmetro, tipo Texto) ----------
// No Excel da área de trabalho: Arquivo > Informações > Copiar caminho. Cole o endereço e apague
// o final "?web=1". Fica parecido com:
// https://<empresa>.sharepoint.com/sites/<site>/Documentos Compartilhados/<pasta>/<planilha>.xlsx
// Na primeira atualização, escolha autenticação "Conta organizacional".


// ---------- Consulta: Sites (dimensão; coordenadas aproximadas, ajuste se precisar) ----------
let
    Sites = #table(
        type table [SiteId = text, Site = text, Municipio = text, Latitude = number, Longitude = number, Ordem = Int64.Type],
        {
            {"fabrica", "Fábrica", "Ouro Preto", -20.4135, -43.8814, 1},
            {"viga", "Viga", "Congonhas", -20.455, -43.835, 2},
            {"feijao", "Córrego do Feijão", "Brumadinho", -20.129, -44.110, 3},
            {"cpx", "Capão Xavier", "Nova Lima", -20.046, -43.985, 4},
            {"marazul", "Mar Azul", "Nova Lima", -20.115, -43.970, 5},
            {"mutuca", "Mutuca", "Nova Lima", -20.030, -43.968, 6}
        })
in
    Sites


// ---------- Consulta: ApelidosSite (desmarque "Habilitar carga") ----------
// Grafias aceitas na coluna Site da planilha, em MAIÚSCULAS. Novo site ou nova grafia: acrescente aqui.
let
    Apelidos = #table(
        type table [Chave = text, SiteId = text],
        {
            {"MUTUCA", "mutuca"}, {"MINA DE MUTUCA", "mutuca"},
            {"CPX", "cpx"}, {"CAPÃO XAVIER", "cpx"}, {"CAPAO XAVIER", "cpx"},
            {"MAR AZUL", "marazul"}, {"MINA MAR AZUL", "marazul"},
            {"FEIJÃO", "feijao"}, {"FEIJAO", "feijao"}, {"CÓRREGO DO FEIJÃO", "feijao"}, {"CORREGO DO FEIJAO", "feijao"},
            {"FÁBRICA", "fabrica"}, {"FABRICA", "fabrica"}, {"MINA DE FÁBRICA", "fabrica"},
            {"VIGA", "viga"}, {"MINA DE VIGA", "viga"}
        })
in
    Apelidos


// ---------- Consulta: Obras (fato) ----------
let
    Origem = Excel.Workbook(Web.Contents(UrlPlanilha), null, true),
    // Abas de dados. Cópias como "PARAOPEBA SUL (2)" (oculta na planilha) ficam de fora.
    Abas = Table.SelectRows(Origem, each [Kind] = "Sheet" and not Text.Contains([Name], "(")),

    Texto = (v) => Text.Trim(Text.Clean(Text.From(v ?? ""))),

    // Cada aba tem um título (ex.: PARAOPEBA NORTE) acima do cabeçalho que começa em "TAP".
    LerAba = (dados as table, nomeAba as text) as table =>
        let
            Linhas = Table.ToRows(dados),
            PrimeiraColuna = List.Transform(Linhas, each Text.Upper(Texto(_{0}))),
            IdxCab = List.PositionOf(PrimeiraColuna, "TAP"),
            Titulos = if IdxCab <= 0 then {} else List.Select(List.FirstN(PrimeiraColuna, IdxCab), each _ <> ""),
            Regional = Text.Proper(if List.IsEmpty(Titulos) then nomeAba else List.First(Titulos)),
            CabBruto = if IdxCab < 0 then {} else List.Transform(Linhas{IdxCab}, Texto),
            Cabecalho = List.Transform(List.Positions(CabBruto), (i) => if CabBruto{i} = "" then "Coluna" & Text.From(i + 1) else CabBruto{i}),
            Tabela = if IdxCab < 0 then #table({}, {}) else Table.FromRows(List.Skip(Linhas, IdxCab + 1), Cabecalho)
        in
            Table.AddColumn(Tabela, "Regional", each Regional, type text),

    Combinado = Table.Combine(List.Transform(Table.ToRecords(Abas), each LerAba([Data], [Name]))),
    Renomeado = Table.RenameColumns(Combinado,
        {{"Gestor Vale", "Gestor"}, {"Dta Conclusão", "DataConclusao"}, {"Emergencial?", "Emergencial"}, {"OBSERVAÇÕES", "Observacoes"}},
        MissingField.Ignore),
    Selecionado = Table.SelectColumns(Renomeado,
        {"Regional", "TAP", "Projeto", "Empresa", "Gestor", "Site", "DataConclusao", "Status", "Emergencial", "Observacoes"},
        MissingField.UseNull),
    SemVazias = Table.SelectRows(Selecionado, each Texto([TAP]) <> "" or Texto([Projeto]) <> ""),

    // Ex.: "EXEMPLO ENGENHARIA LTDA" -> "Exemplo"; "EXEMPLO PROJETOS E CONSTRUCOES" -> "Exemplo"
    Sufixos = {" LTDA", " S A", " S/A", " S.A.", " ENGENHARIA E CONSTRUCOES", " ENGENHARIA E CONSTRUÇÕES",
               " PROJETOS E CONSTRUCOES", " PROJETOS E CONSTRUÇÕES", " ENGENHARIA"},
    EmpresaCurta = (t as text) as text =>
        let u = Text.Upper(t)
        in if u = "" or Text.StartsWith(u, "NÃO DEFIN") or Text.StartsWith(u, "NAO DEFIN") then "Não definida"
           else Text.Proper(List.Accumulate(Sufixos, u, (s, x) => if Text.EndsWith(s, x) then Text.Start(s, Text.Length(s) - Text.Length(x)) else s)),

    Tratado = Table.TransformColumns(SemVazias, {
        {"TAP", Texto, type text},
        {"Projeto", each Text.Trim(Text.Replace(Texto(_), "**", "")), type text},
        {"Empresa", each EmpresaCurta(Texto(_)), type text},
        {"Gestor", each Text.Proper(Texto(_)), type text},
        {"Site", each Text.Upper(Texto(_)), type text},
        {"Status", each
            let t = Text.Lower(Texto(_)) in
            if Text.StartsWith(t, "conclu") then "Concluída"
            else if Text.StartsWith(t, "em exec") then "Em execução"
            else if Text.StartsWith(t, "a iniciar") then "A iniciar"
            else if t = "" then "Não informado"
            else Text.Proper(t), type text},
        {"Emergencial", each
            let t = Text.Upper(Texto(_)) in
            if t = "SIM" then "Sim" else if t = "NÃO" or t = "NAO" then "Não" else "Não informado", type text},
        {"Observacoes", each let t = Texto(_) in if Text.Upper(Text.Remove(t, " ")) = "SEMSTATUS" then "" else t, type text},
        {"DataConclusao", each try Date.From(_) otherwise null, type nullable date}
    }),

    // Situação documental (SIT / NAP / As Built / Data Book) lida do texto de Observações.
    // Mesma regra do painel HTML. O ideal é virar uma coluna própria na planilha.
    ComDoc = Table.AddColumn(Tratado, "SituacaoDocumental", each
        let
            t = Text.Lower([Observacoes]),
            Tem = (lista as list) => List.AnyTrue(List.Transform(lista, (k) => Text.Contains(t, k)))
        in
            if t = "" then "Sem registro"
            else if Tem({"pendente", "pendência", "não tem numera", "solicitou número", "subir revis", "repostagem", "fazer altera", "aguardando"}) then "Pendente"
            else if Tem({"aprovad", "entregue", "finalizad"}) then "Aprovada"
            else "Em andamento", type text),

    ComApelido = Table.NestedJoin(ComDoc, {"Site"}, ApelidosSite, {"Chave"}, "Apelido", JoinKind.LeftOuter),
    Expandido = Table.ExpandTableColumn(ComApelido, "Apelido", {"SiteId"}, {"SiteCadastro"}),
    // Site sem cadastro continua aparecendo nas tabelas, só não vai para o mapa.
    ComSiteId = Table.AddColumn(Expandido, "SiteId", each [SiteCadastro] ?? ("sem cadastro: " & [Site]), type text),
    Resultado = Table.RenameColumns(Table.RemoveColumns(ComSiteId, {"SiteCadastro"}), {{"Site", "SiteNaPlanilha"}})
in
    Resultado
