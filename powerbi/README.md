# Kit para montar o painel no Power BI

O painel HTML (`painel/painel-obras-implantacao-2026.html`) serve como protótipo: mostra o layout, as cores e as regras. Este kit leva a mesma lógica para o Power BI, ligado direto na planilha do SharePoint e com atualização agendada.

Arquivos:

| Arquivo | Para quê |
|---|---|
| `gerar_pbip.py` | Gera o projeto pronto do Power BI (`.pbip`): modelo, medidas e as três páginas do relatório |
| `validar_pbip.py`, `validar_m.mjs` | Conferem o projeto gerado: esquemas oficiais, campos dos visuais, DAX e sintaxe do Power Query |
| `consultas-power-query.pq` | As mesmas consultas, para quem preferir montar o relatório à mão |
| `tema-vale.json` | Tema com as cores e a tipografia do guia de marca (Exibir > Temas > Procurar temas) |

## Projeto pronto (.pbip)

```bash
python3 powerbi/gerar_pbip.py --saida dist/pbip \
    --site https://<empresa>.sharepoint.com/sites/<site> \
    --arquivo "CONTROLE OBRAS IMPLANTAÇÃO 2026 - QUALIDADE.xlsx"

# conferência (precisa de: pip install jsonschema; npm install; clone de github.com/microsoft/json-schemas)
python3 powerbi/validar_pbip.py dist/pbip --esquemas ../json-schemas
```

O projeto tem:

- **Modelo semântico** (`model.bim`): tabela `Obras` lida do SharePoint com `SharePoint.Files` (acha a planilha pelo nome, em qualquer pasta do site), tabela `Sites` com as coordenadas, parâmetros `SiteSharePoint` e `NomeArquivo`, colunas de prazo e as medidas da seção 3.
- **Relatório** (formato PBIR), páginas de 1280 × 720 com o tema Vale:
  - *Visão geral*: filtros sincronizados entre as páginas, cartões, mapa (bolhas por site sobre uma imagem da região: vermelha = emergenciais, verde = não emergenciais, tamanho = nº de obras), obras por site e status, e radar de prazos.
  - *Prazos e documentação*: conclusões por mês, fechamento documental por site, concluídas há mais tempo sem documentação aprovada, contratadas e gestores.
  - *Lista de obras*: tabela completa.

O mapa padrão é um gráfico de dispersão (longitude × latitude) com a imagem dos limites municipais no fundo, gerada pelo próprio script na extensão exata dos eixos. Ele não depende do Azure Maps, que costuma vir desabilitado nos locatários corporativos. Se o administrador liberar o Azure Maps, gere com `--mapa azure` para usar o visual nativo (zoom e satélite).

Para abrir: extraia a pasta, abra o `.pbip` no Power BI Desktop (junho de 2025 ou mais recente) e clique em *Atualizar*. O projeto não guarda dados; na primeira atualização o Power BI pede a conta da organização para o SharePoint. Se o site tiver muitos arquivos e a atualização ficar lenta, troque `SharePoint.Files` por `Web.Contents` com o caminho direto do arquivo.

## 1. Dados

1. Crie o parâmetro **UrlPlanilha** com o caminho da planilha no SharePoint (instruções no topo do `.pq`).
2. Crie as três consultas colando cada bloco do `.pq` no Editor avançado. Em `ApelidosSite`, desmarque *Habilitar carga*.
3. Relacione `Obras[SiteId]` → `Sites[SiteId]` (muitos para um, filtro em direção única).
4. Na tabela `Sites`, classifique a coluna `Site` pela coluna `Ordem`. Em *Categoria de dados*, marque `Latitude` e `Longitude`.

## 2. Colunas calculadas (tabela Obras)

`TODAY()` em coluna calculada é avaliado na atualização do conjunto de dados. Com atualização diária, os prazos ficam corretos.

```DAX
Faixa de prazo =
VAR d = Obras[DataConclusao]
RETURN
    SWITCH (
        TRUE (),
        Obras[Status] = "Concluída", "Concluída",
        ISBLANK ( d ), "Sem data",
        d < TODAY (), "Atrasada",
        d <= TODAY () + 30, "Vence em até 30 dias",
        "No prazo"
    )

Dias de atraso =
IF ( Obras[Faixa de prazo] = "Atrasada", DATEDIFF ( Obras[DataConclusao], TODAY (), DAY ) )

Dias para concluir =
IF ( Obras[Faixa de prazo] IN { "Vence em até 30 dias", "No prazo" }, DATEDIFF ( TODAY (), Obras[DataConclusao], DAY ) )

Dias com pendência documental =
IF (
    Obras[Status] = "Concluída" && Obras[SituacaoDocumental] <> "Aprovada" && NOT ISBLANK ( Obras[DataConclusao] ),
    DATEDIFF ( Obras[DataConclusao], TODAY (), DAY )
)
```

## 3. Medidas

```DAX
Qtd Obras = COUNTROWS ( Obras )
Emergenciais = CALCULATE ( [Qtd Obras], Obras[Emergencial] = "Sim" )
Não emergenciais = CALCULATE ( [Qtd Obras], Obras[Emergencial] = "Não" )
Emergenciais ativas = CALCULATE ( [Emergenciais], Obras[Status] <> "Concluída" )
Atrasadas = CALCULATE ( [Qtd Obras], Obras[Faixa de prazo] = "Atrasada" )
Vencem em 30 dias = CALCULATE ( [Qtd Obras], Obras[Faixa de prazo] = "Vence em até 30 dias" )
Concluídas = CALCULATE ( [Qtd Obras], Obras[Status] = "Concluída" )
Concluídas com pendência documental = CALCULATE ( [Concluídas], Obras[SituacaoDocumental] <> "Aprovada" )
% Documentação aprovada = DIVIDE ( [Concluídas] - [Concluídas com pendência documental], [Concluídas] )

-- cor da bolha no mapa: vermelho se o site tem obra emergencial no filtro, verde se não tem
Cor da bolha = IF ( [Emergenciais] > 0, "#B42318", "#2FB05A" )
```

## 4. Página principal (mesma ordem do protótipo)

1. **Faixa de título** em Verde-Vale `#007E7A` com texto branco e linha de 4 px em Amarelo-Vale `#ECB11F` embaixo. Logo oficial no canto superior esquerdo, a partir do Pacote de Identidade Visual da intranet.
2. **Segmentações em uma linha:** Regional, Status, Emergencial, Faixa de prazo, Gestor, Empresa.
3. **Cartões:** `Qtd Obras` (maior), `Emergenciais`, `Atrasadas`, `Vencem em 30 dias`, `Concluídas com pendência documental`.
4. **Mapa (Azure Maps):**
   - Latitude = `Sites[Latitude]`, Longitude = `Sites[Longitude]`, Tamanho = `[Qtd Obras]`.
   - Camada de bolhas > Cor > *fx* > Valor do campo = `[Cor da bolha]`.
   - Dicas de ferramenta: `Sites[Site]`, `[Qtd Obras]`, `[Emergenciais]`, `[Não emergenciais]`, `[Atrasadas]`.
   - Rótulos de categoria ligados, para o nome do site aparecer ao lado da bolha.
   - Se o mapa não aparecer, o administrador do Power BI precisa liberar o Azure Maps nas configurações do locatário.
   - Para mostrar a divisão emergencial/não emergencial dentro da bolha (pizza), teste colocar `Obras[Emergencial]` em *Legenda*. O resultado depende da versão do visual; se ele empilhar bolhas no mesmo ponto, fique com a cor por regra e a divisão na dica de ferramenta.
5. **Obras por site:** barras empilhadas, eixo `Sites[Site]`, legenda `Obras[Status]`, valor `[Qtd Obras]`. Cores: A iniciar `#0ABB98`, Em execução `#00948D`, Concluída `#034944`.
6. **Radar de prazos:** tabela com TAP, Projeto, Site, Gestor, `Dias de atraso` e `Dias para concluir`, filtrada em Faixa de prazo = Atrasada ou Vence em até 30 dias.
7. **Linha do tempo:** gráfico de dispersão com X = `Obras[DataConclusao]`, Y = `Sites[Ordem]` (eixo Y oculto, nomes dos sites em caixas de texto), cor por `Obras[Emergencial]` (Sim `#B42318`, Não `#2FB05A`). Uma linha constante de X na data de hoje marca o presente.
8. **Fechamento documental:** barras empilhadas por site, legenda `Obras[SituacaoDocumental]`, filtro Status = Concluída. Cores: Aprovada `#034944`, Em andamento `#00948D`, Pendente `#E0A619`, Sem registro `#BCBEC0`. Ao lado, uma tabela ordenada por `Dias com pendência documental` (maior primeiro).
9. **Contratadas** e **Gestores Vale:** barras simples em `#00948D` com `[Qtd Obras]`.
10. **Lista de obras:** tabela completa com Observações.

Publique no workspace da área e agende a atualização diária. A conexão com o SharePoint Online não precisa de gateway.
