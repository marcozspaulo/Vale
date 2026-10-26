# Painel de obras de implantação 2026 (qualidade)

Painel visual da planilha **CONTROLE OBRAS IMPLANTAÇÃO 2026 - QUALIDADE** (Complexo Paraopeba): mapa dos sites com bolhas proporcionais ao número de obras (vermelho = emergencial, verde = não emergencial), indicadores, radar de prazos, linha do tempo, fechamento documental, contratadas, gestores, lista filtrável e um relatório de qualidade da base.

## Usar o painel

Abra `painel/painel-obras-implantacao-2026.html` no Edge ou no Chrome. É um arquivo único: dá para mandar por e-mail ou salvar no SharePoint.

O HTML gerado e a planilha **não ficam no repositório** (estão no `.gitignore`), porque contêm dados internos. Para gerar o arquivo, siga "Gerar o HTML de novo" abaixo.

- **Atualizar os dados:** baixe a planilha do SharePoint e arraste o `.xlsx` para dentro do painel, ou clique em *Atualizar com nova planilha*. A leitura acontece no próprio navegador; nada é enviado para fora.
- **Filtrar:** clique em um site no mapa, em uma barra, em um cartão de indicador ou use a linha de filtros. Tudo se filtra junto.
- **Mapa de fundo:** com internet, alterna entre mapa claro e satélite. Sem internet, mostra os limites municipais do IBGE, que já vêm no arquivo.
- **Exportar:** o botão *Exportar lista (CSV)* baixa as obras do filtro atual (abre direto no Excel).

## Regras de cálculo

| Item | Regra |
|---|---|
| Atrasada | Não concluída e data de conclusão anterior a hoje |
| Vence em 30 dias | Não concluída e conclusão entre hoje e 30 dias à frente |
| Situação documental | Lida da coluna Observações: "pendente", "não tem numeração", "subir revisão", "repostagem" etc. = Pendente; "aprovado" ou "entregue" = Aprovada; vazio ou "SEM STATUS" = Sem registro; o resto = Em andamento |
| Pendência documental | Obra concluída cuja situação documental não é Aprovada |
| Abas | Só as visíveis. A aba oculta "PARAOPEBA SUL (2)" é ignorada |

As coordenadas dos sites são aproximadas e ficam em `painel/src/sites.js`.

## Gerar o HTML de novo

Necessário para criar o arquivo a partir do código, ou ao mudar o código ou o cadastro de sites.

```bash
npm install
node painel/build.mjs                       # usa o .xlsx mais recente de painel/dados/
node painel/build.mjs caminho/planilha.xlsx # ou indique a planilha
```

Estrutura:

```
painel/
  src/            código do painel (HTML, CSS, leitor de .xlsx, tratamento dos dados, gráficos)
  geo/            limites municipais simplificados (IBGE, via github.com/tbrugz/geodata-br)
  scripts/        geração do recorte de municípios
  dados/          coloque aqui a planilha a embutir no HTML (fora do Git)
  build.mjs       junta tudo em um único arquivo
powerbi/          kit para montar a mesma visão no Power BI
```
