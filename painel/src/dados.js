// Interpreta as abas da planilha CONTROLE OBRAS IMPLANTAÇÃO: encontra o cabeçalho,
// padroniza os campos e registra as inconsistências encontradas na base.
const Dados = (() => {
  const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const limpa = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  const chave = (s) => semAcento(limpa(s)).toUpperCase();
  const PEQUENAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const titulo = (s) => limpa(s).toLowerCase().split(' ')
    .map((w, i) => (i > 0 && PEQUENAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

  const STATUS = ['A iniciar', 'Em execução', 'Concluída'];
  const DOCS = ['Aprovada', 'Em andamento', 'Pendente', 'Sem registro'];

  // nome do cabeçalho (sem acento, minúsculo) -> campo
  function campoDoCabecalho(txt) {
    const t = semAcento(limpa(txt)).toLowerCase();
    if (t === 'tap') return 'tap';
    if (t.startsWith('projeto')) return 'projeto';
    if (t.startsWith('empresa') || t.startsWith('contratada')) return 'empresa';
    if (t.includes('gestor')) return 'gestor';
    if (t === 'site' || t === 'local' || t === 'mina') return 'site';
    if (t.includes('conclus') || t.startsWith('dta') || t.startsWith('data')) return 'data';
    if (t === 'status' || t.startsWith('status')) return 'status';
    if (t.startsWith('emergencia')) return 'emergencial';
    if (t.startsWith('observ') || t === 'obs') return 'obs';
    return null;
  }

  function normalizaStatus(s) {
    const t = semAcento(limpa(s)).toLowerCase();
    if (!t) return 'Não informado';
    if (t.startsWith('conclu') || t.startsWith('finaliz') || t.startsWith('entregue')) return 'Concluída';
    if (t.startsWith('em exec') || t.startsWith('em andamento') || t.startsWith('execu')) return 'Em execução';
    if (t.startsWith('a iniciar') || t.startsWith('nao inici') || t.startsWith('planejad')) return 'A iniciar';
    return titulo(s);
  }

  function normalizaEmergencial(s) {
    const t = chave(s).replace(/\?/g, '');
    if (t === 'SIM' || t === 'S') return true;
    if (t === 'NAO' || t === 'N') return false;
    return null;
  }

  // Situação documental (SIT / NAP / As Built / Data Book) inferida do texto de Observações.
  function classificaDoc(obs) {
    const t = semAcento(obs).toLowerCase();
    if (!t || /^sem\s*status$/.test(t)) return 'Sem registro';
    if (/pendente|pendencia|nao tem numera|solicitou numero|subir revis|repostagem|fazer altera|aguardando/.test(t)) return 'Pendente';
    if (/aprovad|entregue|finalizad/.test(t)) return 'Aprovada';
    return 'Em andamento';
  }

  function nomeCurtoEmpresa(s) {
    let t = limpa(s);
    if (!t || /^n[aã]o defin/i.test(t)) return null;
    let antes;
    do {
      antes = t;
      t = t.replace(/[\s,.-]+(LTDA\.?|S\.?\s?\/?\s?A\.?|EIRELI|EPP|ME)$/i, '')
        .replace(/\s+(ENGENHARIA E CONSTRU[CÇ][OÕ]ES|PROJETOS E CONSTRU[CÇ][OÕ]ES|ENGENHARIA|CONSTRU[CÇ][OÕ]ES)$/i, '')
        .trim();
    } while (t !== antes);
    return titulo(t);
  }

  function converteData(v) {
    if (v == null || v === '') return null;
    let ms = null;
    if (typeof v === 'number') ms = Math.round((v - 25569) * 86400000);
    else {
      const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (m) ms = Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
    }
    if (ms == null) return null;
    const d = new Date(ms);
    const ano = d.getUTCFullYear();
    if (ano < 2000 || ano > 2100) return null;
    return Date.UTC(ano, d.getUTCMonth(), d.getUTCDate());
  }

  const MAPA_SITES = new Map();
  for (const s of SITES) for (const a of s.apelidos) MAPA_SITES.set(a, s);

  function interpretar(abas) {
    const obras = [];
    const avisos = [];
    const variantes = { status: new Map(), empresa: new Map(), nomes: new Map() };
    const ignoradas = [];

    for (const aba of abas) {
      if (aba.oculta) { ignoradas.push(aba.nome); continue; }
      const iCab = aba.linhas.findIndex((l) => {
        const campos = l.valores.map(campoDoCabecalho);
        return campos.includes('tap') && campos.includes('projeto');
      });
      if (iCab < 0) continue;
      const colunas = {};
      aba.linhas[iCab].valores.forEach((v, i) => { const c = campoDoCabecalho(v); if (c && !(c in colunas)) colunas[c] = i; });
      let regional = titulo(aba.nome);
      for (let i = iCab - 1; i >= 0; i--) {
        const primeiro = aba.linhas[i].valores.find((v) => limpa(v));
        if (primeiro && typeof primeiro === 'string') { regional = titulo(primeiro); break; }
      }

      for (const linha of aba.linhas.slice(iCab + 1)) {
        const val = (c) => (c in colunas ? linha.valores[colunas[c]] : null);
        const tapBruto = val('tap') == null ? '' : String(val('tap'));
        const projBruto = limpa(val('projeto'));
        if (!limpa(tapBruto) && !projBruto) continue;

        const tap = limpa(tapBruto);
        const marcador = /\*\*/.test(projBruto);
        const projeto = limpa(projBruto.replace(/\*+/g, ''));
        const projetoInvalido = projeto.length > 110 || /\b(sobre mim|minha|meu|eu)\b/i.test(projeto);

        const siteBruto = limpa(val('site'));
        const site = MAPA_SITES.get(chave(siteBruto)) || null;

        const statusBruto = limpa(val('status'));
        const status = normalizaStatus(statusBruto);
        if (statusBruto) {
          if (!variantes.status.has(status)) variantes.status.set(status, new Set());
          variantes.status.get(status).add(statusBruto);
        }

        const empresaBruta = limpa(val('empresa'));
        const empresa = nomeCurtoEmpresa(empresaBruta);
        if (empresa) {
          if (!variantes.empresa.has(empresa)) variantes.empresa.set(empresa, new Set());
          variantes.empresa.get(empresa).add(empresaBruta);
        }

        const gestorBruto = limpa(val('gestor'));
        for (const bruto of [gestorBruto, siteBruto]) {
          if (!bruto) continue;
          if (!variantes.nomes.has(chave(bruto))) variantes.nomes.set(chave(bruto), new Set());
          variantes.nomes.get(chave(bruto)).add(bruto);
        }

        const obsBruta = limpa(val('obs'));
        const obs = /^sem\s*status$/i.test(obsBruta) ? '' : obsBruta;

        obras.push({
          id: obras.length,
          aba: aba.nome,
          linha: linha.numero,
          regional,
          tap,
          tapComEspaco: tapBruto !== tap,
          projeto: projetoInvalido ? '' : projeto,
          projetoInvalido,
          marcador,
          siteId: site ? site.id : 'sem-site:' + chave(siteBruto),
          site: site ? site.nome : (titulo(siteBruto) || 'Não informado'),
          siteConhecido: !!site,
          empresa: empresa || 'Não definida',
          empresaCompleta: empresaBruta,
          gestor: titulo(gestorBruto) || 'Não informado',
          data: converteData(val('data')),
          status,
          emergencial: normalizaEmergencial(val('emergencial')),
          obs,
          semStatus: !obs,
          doc: classificaDoc(obs),
        });
      }
    }

    // ---- inconsistências da base ----
    const ref = (o) => o.tap || `${o.aba}, linha ${o.linha}`;
    const add = (titulo, itens, dica) => { if (itens.length) avisos.push({ titulo, itens, dica }); };

    add('Descrição do projeto fora do padrão', obras.filter((o) => o.projetoInvalido).map((o) => `${ref(o)} (aba ${o.aba}, linha ${o.linha})`),
      'O campo Projeto contém um texto que não descreve a obra. No painel ele aparece como "descrição a revisar".');

    const porTap = new Map();
    for (const o of obras) if (o.tap) porTap.set(o.tap, [...(porTap.get(o.tap) || []), o]);
    add('TAP repetido em mais de uma obra', [...porTap].filter(([, l]) => l.length > 1)
      .map(([t, l]) => `${t}: ${l.map((o) => o.projeto || 'descrição a revisar').join(' · ')}`),
      'Se forem frentes diferentes do mesmo TAP, vale criar um sufixo (ex.: S-1234-1 e S-1234-2).');

    add('TAP com espaços extras', obras.filter((o) => o.tapComEspaco).map((o) => `"${o.tap}" (aba ${o.aba}, linha ${o.linha})`),
      'Espaços antes ou depois do código atrapalham buscas e cruzamentos.');

    add('TAP fora do padrão S-0000', obras.filter((o) => o.tap && !/^S-\d{3,5}(-\d+)?$/.test(o.tap)).map((o) => o.tap),
      'A maioria das linhas usa "S-" seguido de números (ex.: S-1234). Fora disso, buscas e cruzamentos pelo TAP falham.');

    add('Obra sem data de conclusão', obras.filter((o) => o.data == null).map(ref),
      'Sem data, a obra fica fora da linha do tempo e do radar de prazos.');

    add('Obra sem empresa definida', obras.filter((o) => o.empresa === 'Não definida').map(ref), '');

    add('Emergencial não informado', obras.filter((o) => o.emergencial == null).map(ref), 'Preencha com SIM ou NÃO.');

    add('Site sem coordenada cadastrada', [...new Set(obras.filter((o) => !o.siteConhecido).map((o) => o.site))],
      'O site não aparece no mapa. Cadastre-o em painel/src/sites.js.');

    const grafiasStatus = [...variantes.status].filter(([, s]) => s.size > 1).map(([n, s]) => `${n}: ${[...s].map((x) => `"${x}"`).join(', ')}`);
    add('Status com grafias diferentes', grafiasStatus, 'O painel unifica, mas uma lista suspensa na planilha evita o problema.');

    const grafiasEmpresa = [...variantes.empresa].filter(([, s]) => s.size > 1).map(([n, s]) => `${n}: ${[...s].map((x) => `"${x}"`).join(', ')}`);
    add('Mesma empresa com nomes diferentes', grafiasEmpresa, '');

    add('Mesmo gestor ou site escrito de formas diferentes',
      [...variantes.nomes.values()].filter((s) => s.size > 1).map((s) => [...s].map((x) => `"${x}"`).join(' e ')),
      'O painel padroniza para contar como a mesma pessoa ou o mesmo site.');

    const semStatus = obras.filter((o) => o.semStatus && o.status !== 'A iniciar');
    add('Observações vazias ou "SEM STATUS"', semStatus.map(ref), 'Essas obras ficam com situação documental "Sem registro".');

    const marcadas = obras.filter((o) => o.marcador);
    add('Projetos marcados com "**"', marcadas.length ? [`${marcadas.length} obras: ${marcadas.map(ref).join(', ')}`] : [],
      'O significado do marcador não está documentado na planilha. Se for relevante, transforme em uma coluna própria.');

    add('Abas ocultas ignoradas', ignoradas.map((n) => `"${n}"`), 'O painel lê apenas as abas visíveis.');

    return { obras, avisos };
  }

  return { interpretar, STATUS, DOCS, limpa, semAcento };
})();
