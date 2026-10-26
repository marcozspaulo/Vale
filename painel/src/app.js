// Painel de obras — renderização e interação (filtros cruzados, mapa, gráficos e lista).
(() => {
  const COR = {
    emerg: '#b42318', naoEmerg: '#2fb05a', semInfo: '#BCBEC0',
    status: { 'A iniciar': '#0ABB98', 'Em execução': '#00948D', 'Concluída': '#034944' },
    outro: '#BCBEC0',
    doc: { 'Aprovada': '#034944', 'Em andamento': '#00948D', 'Pendente': '#E0A619', 'Sem registro': '#BCBEC0' },
    atraso: '#ec835a', vence: '#fab219', serie: '#00948D',
    verde: '#007E7A', verdeEscuro: '#034944', amarelo: '#ECB11F', amareloClaro: '#FFDD99',
    cinzaClaro: '#E6E7E8', cinzaMedio: '#BCBEC0', texto: '#555555',
  };
  const ORDEM_STATUS = Dados.STATUS;
  const ORDEM_DOC = Dados.DOCS;
  const DIA = 86400000;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const PRAZOS = [
    ['todos', 'Todos'], ['atrasada', 'Atrasadas'], ['vence30', 'Vencem em 30 dias'],
    ['noprazo', 'No prazo (mais de 30 dias)'], ['semdata', 'Sem data'], ['concluida', 'Concluídas'],
  ];
  const PADRAO = { regional: 'todas', status: 'todos', emerg: 'todas', prazo: 'todos', doc: 'todos', gestor: '', empresa: '', site: '', busca: '' };

  const agora = new Date();
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());

  let obras = [];
  let avisos = [];
  const estado = { ...PADRAO };
  const ordem = { coluna: 'padrao', dir: 1 };
  const abertas = new Set();

  // ---------- utilidades ----------
  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) el.append(f instanceof Node ? f : String(f));
    return el;
  }
  function s(tag, attrs, ...filhos) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const f of filhos.flat()) if (f != null) el.append(f instanceof Node ? f : String(f));
    return el;
  }
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (t) => Dados.semAcento(String(t ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
  const fmtData = (ms) => (ms == null ? '—' : new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC' }));
  const fmtMes = (ms) => { const d = new Date(ms); return `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`; };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const corStatus = (st) => COR.status[st] || COR.outro;
  const corEmerg = (o) => (o.emergencial === true ? COR.emerg : o.emergencial === false ? COR.naoEmerg : COR.semInfo);
  const nomeProjeto = (o) => o.projeto || 'Descrição a revisar na base';
  function agrupar(lista, chave) {
    const m = new Map();
    for (const o of lista) { const k = chave(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
    return m;
  }
  const contar = (lista, f) => lista.filter(f).length;

  function prazo(o) {
    if (o.status === 'Concluída') return { tipo: 'concluida', dias: null };
    if (o.data == null) return { tipo: 'semdata', dias: null };
    const dias = Math.round((o.data - hoje) / DIA);
    if (dias < 0) return { tipo: 'atrasada', dias: -dias };
    if (dias <= 30) return { tipo: 'vence30', dias };
    return { tipo: 'noprazo', dias };
  }
  function textoPrazo(p) {
    switch (p.tipo) {
      case 'atrasada': return `${plural(p.dias, 'dia', 'dias')} de atraso`;
      case 'vence30': return p.dias === 0 ? 'vence hoje' : p.dias === 1 ? 'vence amanhã' : `vence em ${p.dias} dias`;
      case 'noprazo': return `em ${p.dias} dias`;
      case 'semdata': return 'sem data';
      default: return 'concluída';
    }
  }
  const ativa = (o) => o.status !== 'Concluída';
  const docPendente = (o) => o.status === 'Concluída' && o.doc !== 'Aprovada';

  // ---------- filtros ----------
  function passa(o, ignorar) {
    const e = estado;
    if (ignorar !== 'regional' && e.regional !== 'todas' && o.regional !== e.regional) return false;
    if (ignorar !== 'status' && e.status !== 'todos' && (e.status === 'ativas' ? !ativa(o) : o.status !== e.status)) return false;
    if (ignorar !== 'emerg' && e.emerg !== 'todas' && o.emergencial !== (e.emerg === 'sim')) return false;
    if (ignorar !== 'prazo' && e.prazo !== 'todos' && prazo(o).tipo !== e.prazo) return false;
    if (ignorar !== 'doc' && e.doc === 'pendente' && !docPendente(o)) return false;
    if (ignorar !== 'gestor' && e.gestor && o.gestor !== e.gestor) return false;
    if (ignorar !== 'empresa' && e.empresa && o.empresa !== e.empresa) return false;
    if (ignorar !== 'site' && e.site && o.siteId !== e.site) return false;
    if (ignorar !== 'busca' && e.busca) {
      const alvo = norm([o.tap, o.projeto, o.obs, o.site, o.empresa, o.empresaCompleta, o.gestor].join(' '));
      if (!norm(e.busca).split(' ').every((t) => alvo.includes(t))) return false;
    }
    return true;
  }
  const filtradas = (ignorar) => obras.filter((o) => passa(o, ignorar));
  function definir(campo, valor) { estado[campo] = valor; render(); }
  function alternar(campo, valor) { definir(campo, estado[campo] === valor ? PADRAO[campo] : valor); }

  function segmentado(cont, campo, opcoes) {
    cont.replaceChildren(...opcoes.map(([v, rot]) => h('button', {
      type: 'button', 'data-v': v, 'aria-pressed': String(estado[campo] === v), onclick: () => definir(campo, v),
    }, rot)));
  }
  function opcoesSelect(sel, campo, opcoes) {
    sel.replaceChildren(...opcoes.map(([v, rot]) => h('option', { value: v }, rot)));
    sel.value = estado[campo];
    sel.onchange = () => definir(campo, sel.value);
  }
  function montarFiltros() {
    const regionais = [...new Set(obras.map((o) => o.regional))].sort();
    segmentado($('f-regional'), 'regional', [['todas', 'Todas'], ...regionais.map((r) => [r, r])]);
    const extras = [...new Set(obras.map((o) => o.status))].filter((x) => !ORDEM_STATUS.includes(x)).sort();
    segmentado($('f-status'), 'status', [['todos', 'Todos'], ['ativas', 'Não concluídas'], ...[...ORDEM_STATUS, ...extras].map((x) => [x, x])]);
    segmentado($('f-emerg'), 'emerg', [['todas', 'Todas'], ['sim', 'Emergenciais'], ['nao', 'Não emergenciais']]);
    opcoesSelect($('f-prazo'), 'prazo', PRAZOS);
    const gestores = [...new Set(obras.map((o) => o.gestor))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    opcoesSelect($('f-gestor'), 'gestor', [['', 'Todos'], ...gestores.map((g) => [g, g])]);
    const empresas = [...new Set(obras.map((o) => o.empresa))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    opcoesSelect($('f-empresa'), 'empresa', [['', 'Todas'], ...empresas.map((x) => [x, x])]);
    const busca = $('f-busca');
    let espera;
    busca.oninput = () => { clearTimeout(espera); espera = setTimeout(() => definir('busca', busca.value.trim()), 180); };
  }
  function sincronizarFiltros() {
    for (const [id, campo] of [['f-regional', 'regional'], ['f-status', 'status'], ['f-emerg', 'emerg']]) {
      for (const b of $(id).children) b.setAttribute('aria-pressed', String(b.dataset.v === estado[campo]));
    }
    $('f-prazo').value = estado.prazo;
    $('f-gestor').value = estado.gestor;
    $('f-empresa').value = estado.empresa;
    if ($('f-busca').value.trim() !== estado.busca) $('f-busca').value = estado.busca;
  }

  function renderAtivos() {
    const chips = [];
    const add = (rot, campo) => chips.push(h('span', { class: 'chip-ativo' }, rot,
      h('button', { type: 'button', 'aria-label': `Remover filtro ${rot}`, onclick: () => definir(campo, PADRAO[campo]) }, '×')));
    if (estado.site) add(`Site: ${(SITES.find((x) => x.id === estado.site) || {}).nome || estado.site}`, 'site');
    if (estado.regional !== 'todas') add(`Regional: ${estado.regional}`, 'regional');
    if (estado.status !== 'todos') add(`Status: ${estado.status === 'ativas' ? 'não concluídas' : estado.status}`, 'status');
    if (estado.emerg !== 'todas') add(estado.emerg === 'sim' ? 'Somente emergenciais' : 'Somente não emergenciais', 'emerg');
    if (estado.prazo !== 'todos') add(`Prazo: ${PRAZOS.find((p) => p[0] === estado.prazo)[1].toLowerCase()}`, 'prazo');
    if (estado.doc === 'pendente') add('Concluídas com pendência documental', 'doc');
    if (estado.gestor) add(`Gestor: ${estado.gestor}`, 'gestor');
    if (estado.empresa) add(`Empresa: ${estado.empresa}`, 'empresa');
    if (estado.busca) add(`Busca: "${estado.busca}"`, 'busca');
    if (chips.length) {
      chips.push(h('button', { type: 'button', class: 'btn-link', onclick: () => { Object.assign(estado, PADRAO); render(); } }, 'Limpar filtros'));
    }
    $('ativos').replaceChildren(...chips);
  }

  // ---------- tooltip ----------
  const tt = $('tooltip');
  function posicionar(x, y) {
    const r = tt.getBoundingClientRect();
    let esq = x + 14, topo = y + 14;
    if (esq + r.width > innerWidth - 8) esq = x - r.width - 14;
    if (topo + r.height > innerHeight - 8) topo = y - r.height - 14;
    tt.style.left = `${Math.max(8, esq)}px`;
    tt.style.top = `${Math.max(8, topo)}px`;
  }
  function mostrarTip(conteudo, x, y) { tt.replaceChildren(...conteudo); tt.hidden = false; posicionar(x, y); }
  function esconderTip() { tt.hidden = true; }
  function ligarTip(el, conteudo) {
    el.addEventListener('pointerenter', (e) => mostrarTip(conteudo(), e.clientX, e.clientY));
    el.addEventListener('pointermove', (e) => posicionar(e.clientX, e.clientY));
    el.addEventListener('pointerleave', esconderTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); mostrarTip(conteudo(), r.left + r.width / 2, r.bottom); });
    el.addEventListener('blur', esconderTip);
  }
  const ttTit = (t) => h('div', { class: 'tt-tit' }, t);
  const ttTxt = (t) => h('div', null, t);
  const ttSep = () => h('div', { class: 'tt-sep' });
  const ttLin = (valor, rot, cor) => h('div', { class: 'tt-lin' }, cor ? h('span', { class: 'tt-key', style: `background:${cor}` }) : null, h('strong', null, valor), rot);
  function tipObra(o) {
    const p = prazo(o);
    return [
      ttTit(o.tap || 'Sem TAP'),
      ttTxt(nomeProjeto(o)),
      ttSep(),
      ttTxt(`${o.site} · ${o.regional}`),
      ttTxt(`Conclusão: ${fmtData(o.data)}${p.tipo !== 'concluida' && p.tipo !== 'semdata' ? ' · ' + textoPrazo(p) : ''}`),
      ttLin('', `${o.status} · ${o.emergencial === true ? 'emergencial' : o.emergencial === false ? 'não emergencial' : 'emergencial não informado'}`, corEmerg(o)),
      ttTxt(`${o.gestor} · ${o.empresa}`),
      ttTxt(`Documentação: ${o.doc.toLowerCase()}`),
    ];
  }

  // ---------- ícones (grid 24 × 24, Verde-Vale + Amarelo-Vale) ----------
  const V = COR.verde, A = COR.amarelo;
  const ICONE = {
    obra: `<path d="M5 15a7 7 0 0 1 14 0" fill="${A}" stroke="${V}"/><path d="M3 15h18v3H3z" fill="${V}" stroke="${V}"/><path d="M12 8v4" stroke="${V}"/>`,
    alerta: `<path d="M12 3 2.5 20h19z" fill="${A}" stroke="${V}"/><path d="M12 10v4M12 17h.01" stroke="${V}"/>`,
    relogio: `<circle cx="12" cy="12" r="9" fill="${A}" stroke="${V}"/><path d="M12 7v5l3 2" stroke="${V}"/>`,
    calendario: `<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="${V}"/><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3z" fill="${A}" stroke="${V}"/><path d="M8 3v4M16 3v4" stroke="${V}"/>`,
    documento: `<path d="M6 3h8l4 4v14H6z" fill="${A}" stroke="${V}"/><path d="M14 3v4h4M9 12h6M9 16h6" stroke="${V}"/>`,
  };
  function icone(nome) {
    const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONE[nome]}</svg>`;
    return span;
  }

  // ---------- indicadores ----------
  function renderKpis(lista) {
    const total = lista.length;
    const emerg = lista.filter((o) => o.emergencial === true);
    const atrasadas = lista.filter((o) => prazo(o).tipo === 'atrasada').sort((a, b) => prazo(b).dias - prazo(a).dias);
    const vence = lista.filter((o) => prazo(o).tipo === 'vence30');
    const concl = lista.filter((o) => o.status === 'Concluída');
    const pend = concl.filter(docPendente);

    const statusPresentes = [...ORDEM_STATUS, ...new Set(lista.map((o) => o.status).filter((x) => !ORDEM_STATUS.includes(x)))];
    const partes = statusPresentes.map((st) => ({ st, n: contar(lista, (o) => o.status === st) })).filter((p) => p.n);
    const barra = h('div', { class: 'mini-barra', role: 'img', 'aria-label': partes.map((p) => `${p.st}: ${p.n}`).join(', ') },
      partes.map((p) => h('span', { style: `flex:${p.n} 1 0;background:${corStatus(p.st)}`, title: `${p.st}: ${p.n}` })));
    const leg = h('ul', { class: 'legenda', style: 'margin:0' }, partes.map((p) => h('li', null,
      h('span', { class: 'sw', style: `background:${corStatus(p.st)}` }), h('b', null, p.n), p.st.toLowerCase())));

    const hero = h('div', { class: 'kpi hero' },
      h('span', { class: 'rot' }, filtroAtivo() ? 'Obras no filtro' : 'Obras cadastradas'), icone('obra'),
      h('span', { class: 'val' }, total),
      h('div', null, total ? barra : null, leg));

    function tile(rot, val, det, ico, ativo, acao) {
      return h('button', { type: 'button', class: 'kpi', 'aria-pressed': String(ativo), onclick: acao, title: ativo ? 'Clique para remover o filtro' : 'Clique para filtrar' },
        h('span', { class: 'rot' }, rot), icone(ico), h('span', { class: 'val' }, val), h('span', { class: 'det' }, det));
    }
    const detAtraso = atrasadas.length === 0 ? 'nenhuma com prazo vencido'
      : atrasadas.length === 1 ? `${atrasadas[0].tap} · ${textoPrazo(prazo(atrasadas[0]))}`
        : `a maior com ${textoPrazo(prazo(atrasadas[0]))}`;
    $('kpis').replaceChildren(
      hero,
      tile('Emergenciais', emerg.length, `${emerg.filter(ativa).length} em execução ou a iniciar`, 'alerta', estado.emerg === 'sim', () => alternar('emerg', 'sim')),
      tile('Atrasadas', atrasadas.length, detAtraso, 'relogio', estado.prazo === 'atrasada', () => alternar('prazo', 'atrasada')),
      tile('Vencem em 30 dias', vence.length, `até ${fmtData(hoje + 30 * DIA)}`, 'calendario', estado.prazo === 'vence30', () => alternar('prazo', 'vence30')),
      tile('Pendência documental', pend.length, `de ${plural(concl.length, 'concluída', 'concluídas')} sem documentação aprovada`, 'documento', estado.doc === 'pendente', () => alternar('doc', 'pendente')),
    );
  }
  const filtroAtivo = () => Object.keys(PADRAO).some((k) => estado[k] !== PADRAO[k]);

  // ---------- mapa ----------
  let mapa, munLayer, rotulosMun, legendaMapa, avisoMapaCtl;
  const tiles = {};
  const marcadores = new Map();
  let baseAtual = null;

  function iniciarMapa() {
    mapa = L.map('mapa', { zoomSnap: 0.25, zoomDelta: 0.5, scrollWheelZoom: false, attributionControl: true });
    mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    mapa.on('click', () => mapa.scrollWheelZoom.enable());
    mapa.getContainer().addEventListener('mouseleave', () => mapa.scrollWheelZoom.disable());

    tiles.mapa = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    });
    tiles.satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
    });
    for (const [nome, camada] of Object.entries(tiles)) {
      let ok = 0, erro = 0;
      camada.on('tileload', () => { ok++; });
      camada.on('tileerror', () => {
        erro++;
        if (!ok && erro >= 4 && baseAtual === nome) {
          trocarBase('limites');
          avisoMapa('Sem acesso aos mapas online. Exibindo os limites municipais, que funcionam offline.');
        }
      });
    }

    const municipiosComSite = new Set(SITES.map((x) => x.municipio));
    munLayer = L.geoJSON(GEO, {
      interactive: false,
      style: (f) => estiloMunicipio(f, municipiosComSite),
    }).addTo(mapa);
    rotulosMun = L.layerGroup(GEO.features.map((f) => L.marker([f.properties.rotulo[1], f.properties.rotulo[0]], {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'rotulo-mun', html: `<span>${esc(f.properties.nome)}</span>`, iconSize: [0, 0] }),
    })));
    munLayer._comSite = municipiosComSite;

    const ControleBase = L.Control.extend({
      onAdd() {
        const div = h('div', { class: 'ctl-base', role: 'group', 'aria-label': 'Fundo do mapa' },
          [['mapa', 'Mapa'], ['satelite', 'Satélite'], ['limites', 'Só limites']].map(([v, rot]) =>
            h('button', { type: 'button', 'data-base': v, onclick: () => trocarBase(v) }, rot)),
          h('button', { type: 'button', title: 'Enquadrar todos os sites', onclick: enquadrar }, 'Ver todos'));
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      },
    });
    new ControleBase({ position: 'topright' }).addTo(mapa);
    legendaMapa = new (L.Control.extend({ onAdd: () => { const d = h('div', { class: 'ctl-legenda' }); L.DomEvent.disableClickPropagation(d); return d; } }))({ position: 'bottomleft' }).addTo(mapa);

    for (const site of SITES) {
      const m = L.marker([site.lat, site.lon], { keyboard: true, title: site.nome, riseOnHover: true });
      m.on('click', () => { esconderTip(); alternar('site', site.id); });
      m.on('mouseover', (e) => mostrarTip(tipSite(site), e.originalEvent.clientX, e.originalEvent.clientY));
      m.on('mousemove', (e) => posicionar(e.originalEvent.clientX, e.originalEvent.clientY));
      m.on('mouseout', esconderTip);
      m.addTo(mapa);
      marcadores.set(site.id, m);
    }
    trocarBase('mapa');
    enquadrar();
    let primeiro = true;
    new ResizeObserver(() => {
      mapa.invalidateSize({ pan: false });
      if (primeiro) { primeiro = false; enquadrar(); }
    }).observe(mapa.getContainer());
  }

  function estiloMunicipio(f, comSite) {
    if (baseAtual === 'satelite') return { color: '#FFFFFF', weight: 1, opacity: 0.8, fill: false };
    if (baseAtual === 'limites') {
      return { color: COR.cinzaMedio, weight: 1, opacity: 1, fill: true, fillOpacity: 1,
        fillColor: comSite && comSite.has(f.properties.nome) ? COR.cinzaClaro : '#FFFFFF' };
    }
    return { color: COR.cinzaMedio, weight: 1.2, opacity: 1, fill: false };
  }

  function trocarBase(nome) {
    baseAtual = nome;
    for (const [n, camada] of Object.entries(tiles)) {
      if (n === nome) camada.addTo(mapa); else mapa.removeLayer(camada);
    }
    munLayer.setStyle((f) => estiloMunicipio(f, munLayer._comSite));
    if (nome === 'limites') rotulosMun.addTo(mapa); else mapa.removeLayer(rotulosMun);
    document.querySelectorAll('.ctl-base [data-base]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === nome)));
  }

  function avisoMapa(texto) {
    if (avisoMapaCtl) return;
    avisoMapaCtl = new (L.Control.extend({ onAdd: () => h('div', { class: 'ctl-aviso' }, texto) }))({ position: 'topleft' }).addTo(mapa);
    setTimeout(() => avisoMapaCtl.remove(), 10000);
  }

  function enquadrar() {
    const b = L.latLngBounds(SITES.map((x) => [x.lat, x.lon]));
    const larg = mapa.getSize().x;
    const lado = Math.min(150, Math.round(larg * 0.22));
    mapa.fitBounds(b, { paddingTopLeft: [lado, 56], paddingBottomRight: [lado, 56], maxZoom: 13 });
  }

  function pizzaSvg(r, partes, selecionado) {
    const c = r + 6, tam = 2 * c;
    const total = partes.reduce((a, p) => a + p.v, 0);
    let corpo = '';
    if (!total) {
      corpo = `<circle cx="${c}" cy="${c}" r="${r}" fill="${COR.cinzaMedio}"/>`;
    } else {
      let a = -Math.PI / 2;
      for (const p of partes.filter((x) => x.v > 0)) {
        if (p.v === total) { corpo += `<circle cx="${c}" cy="${c}" r="${r}" fill="${p.cor}"/>`; break; }
        const a2 = a + (2 * Math.PI * p.v) / total;
        const x1 = c + r * Math.cos(a), y1 = c + r * Math.sin(a), x2 = c + r * Math.cos(a2), y2 = c + r * Math.sin(a2);
        corpo += `<path d="M${c},${c}L${x1.toFixed(2)},${y1.toFixed(2)}A${r},${r} 0 ${a2 - a > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}Z" fill="${p.cor}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
        a = a2;
      }
    }
    corpo += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#fff" stroke-width="2.5"/>`;
    if (selecionado) corpo += `<circle cx="${c}" cy="${c}" r="${r + 3.5}" fill="none" stroke="${COR.verde}" stroke-width="3"/>`;
    return `<svg width="${tam}" height="${tam}" viewBox="0 0 ${tam} ${tam}" aria-hidden="true">${corpo}</svg>`;
  }

  const raio = (n, max) => (n ? Math.max(9, 30 * Math.sqrt(n / max)) : 5);

  function tipSite(site) {
    const lista = filtradas('site').filter((o) => o.siteId === site.id);
    const ne = contar(lista, (o) => o.emergencial === true), nn = contar(lista, (o) => o.emergencial === false);
    const prox = lista.filter((o) => ativa(o) && o.data != null).sort((a, b) => a.data - b.data)[0];
    const regional = lista[0] ? lista[0].regional : '';
    return [
      ttTit(site.nome),
      ttTxt([regional, site.municipio].filter(Boolean).join(' · ')),
      ttSep(),
      ttLin(lista.length, lista.length === 1 ? ' obra no filtro' : ' obras no filtro'),
      ttLin(ne, ne === 1 ? ' emergencial' : ' emergenciais', COR.emerg),
      ttLin(nn, nn === 1 ? ' não emergencial' : ' não emergenciais', COR.naoEmerg),
      ttSep(),
      ttTxt(ORDEM_STATUS.map((st) => `${contar(lista, (o) => o.status === st)} ${st.toLowerCase()}`).join(' · ')),
      prox ? ttTxt(`Próxima conclusão: ${fmtData(prox.data)} (${prox.tap})`) : null,
      ttTxt(estado.site === site.id ? 'Clique para remover o filtro' : 'Clique para filtrar o painel por este site'),
    ].filter(Boolean);
  }

  function renderMapa() {
    const base = filtradas('site');
    const porSite = agrupar(base, (o) => o.siteId);
    const max = Math.max(1, ...SITES.map((x) => (porSite.get(x.id) || []).length));
    for (const site of SITES) {
      const lista = porSite.get(site.id) || [];
      const n = lista.length;
      const ne = contar(lista, (o) => o.emergencial === true);
      const nn = contar(lista, (o) => o.emergencial === false);
      const r = raio(n, max);
      const sel = estado.site === site.id;
      const svg = pizzaSvg(r, [{ v: ne, cor: COR.emerg }, { v: nn, cor: COR.naoEmerg }, { v: n - ne - nn, cor: COR.semInfo }], sel);
      const tam = 2 * (r + 6);
      const classes = ['pino', `dir-${site.rotulo || 'direita'}`, estado.site && !sel ? 'apagado' : '', sel ? 'selecionado' : ''].join(' ');
      const html = `<div class="${classes}" style="width:${tam}px;height:${tam}px">${svg}<span class="pino-rotulo"><b>${n}</b>${esc(site.nome)}</span></div>`;
      const m = marcadores.get(site.id);
      m.setIcon(L.divIcon({ className: 'pino-icone', html, iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2] }));
      m.setZIndexOffset(Math.round((max - n) * 10) + (sel ? 1000 : 0));
      const el = m.getElement();
      if (el) el.setAttribute('aria-label', `${site.nome}: ${plural(n, 'obra', 'obras')}, ${ne} emergenciais. Pressione Enter para filtrar.`);
    }
    // legenda de tamanhos
    const refs = [...new Set([max, Math.max(1, Math.round(max / 3)), 1])].sort((a, b) => b - a);
    const rMax = raio(max, max);
    const W = 2 * rMax + 46, H = 2 * rMax + 12;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    for (const v of refs) {
      const r = raio(v, max), cy = H - 2 - r;
      svg += `<circle cx="${rMax + 1}" cy="${cy}" r="${r}" fill="none" stroke="${COR.cinzaMedio}" stroke-width="1"/>`;
      svg += `<line x1="${rMax + 1}" x2="${2 * rMax + 8}" y1="${cy - r}" y2="${cy - r}" stroke="${COR.cinzaMedio}" stroke-width="1"/>`;
      svg += `<text x="${2 * rMax + 11}" y="${cy - r + 4}" font-size="11" fill="${COR.texto}">${v}</text>`;
    }
    svg += '</svg>';
    legendaMapa.getContainer().innerHTML = `<b>Obras por site</b>${svg}
      <div class="linha"><span class="pt" style="background:${COR.emerg}"></span>Emergencial</div>
      <div class="linha"><span class="pt" style="background:${COR.naoEmerg}"></span>Não emergencial</div>`;
  }

  // ---------- barras horizontais ----------
  function linhaBarra({ nome, sub, segmentos, total, max, ativo, apagado, acao, tip }) {
    const pct = max ? (total / max) * 100 : 0;
    const pilha = h('span', { class: 'pilha', style: `width:${pct}%` },
      segmentos.filter((sg) => sg.v > 0).map((sg) => {
        const el = h('span', { style: `flex:${sg.v} 1 0;background:${sg.cor}` });
        ligarTip(el, () => [ttTit(nome), ttLin(sg.v, ` ${sg.rot}`, sg.cor), ttTxt(`Total: ${total}`)]);
        return el;
      }));
    const btn = h('button', {
      type: 'button', class: `barra${apagado ? ' apagada' : ''}`, 'aria-pressed': String(!!ativo), onclick: acao,
      'aria-label': `${nome}: ${total}. ${segmentos.filter((sg) => sg.v).map((sg) => `${sg.rot} ${sg.v}`).join(', ')}`,
    },
    h('span', { class: 'nome' }, nome, sub ? h('small', null, sub) : null),
    h('span', { class: 'trilho', style: 'padding-right:30px' }, pilha, h('span', { class: 'v' }, total)));
    if (tip) ligarTip(btn, tip);
    return btn;
  }

  function renderSites() {
    const base = filtradas('site');
    const grupos = [...agrupar(base, (o) => o.siteId)].map(([id, lista]) => ({ id, lista }))
      .sort((a, b) => b.lista.length - a.lista.length || a.lista[0].site.localeCompare(b.lista[0].site, 'pt-BR'));
    const max = Math.max(0, ...grupos.map((g) => g.lista.length));
    const status = [...ORDEM_STATUS, ...new Set(base.map((o) => o.status).filter((x) => !ORDEM_STATUS.includes(x)))];
    $('leg-status').replaceChildren(...status.map((st) => h('li', null, h('span', { class: 'sw', style: `background:${corStatus(st)}` }), st)));
    const cont = $('graf-sites');
    if (!grupos.length) { cont.replaceChildren(h('p', { class: 'vazio' }, 'Nenhuma obra no filtro.')); return; }
    cont.replaceChildren(...grupos.map(({ id, lista }) => linhaBarra({
      nome: lista[0].site, sub: lista[0].regional,
      segmentos: status.map((st) => ({ rot: st.toLowerCase(), v: contar(lista, (o) => o.status === st), cor: corStatus(st) })),
      total: lista.length, max, ativo: estado.site === id, apagado: estado.site && estado.site !== id,
      acao: () => alternar('site', id),
    })));
  }

  function renderDoc(lista) {
    const concl = lista.filter((o) => o.status === 'Concluída');
    const pend = concl.filter(docPendente).length;
    $('doc-destaque').replaceChildren(
      h('strong', null, concl.length ? `${pend} de ${concl.length}` : '0'),
      h('span', null, concl.length ? 'obras concluídas ainda sem documentação aprovada' : 'nenhuma obra concluída no filtro'));
    $('leg-doc').replaceChildren(...ORDEM_DOC.map((d) => h('li', null, h('span', { class: 'sw', style: `background:${COR.doc[d]}` }), d)));
    const grupos = [...agrupar(concl, (o) => o.siteId)].map(([id, l]) => ({ id, l }))
      .sort((a, b) => b.l.length - a.l.length || a.l[0].site.localeCompare(b.l[0].site, 'pt-BR'));
    const max = Math.max(0, ...grupos.map((g) => g.l.length));
    const cont = $('graf-doc');
    if (!grupos.length) { cont.replaceChildren(); $('doc-antigas').replaceChildren(); return; }
    cont.replaceChildren(...grupos.map(({ id, l }) => linhaBarra({
      nome: l[0].site, sub: `${contar(l, (o) => o.doc === 'Aprovada')} aprovadas`,
      segmentos: ORDEM_DOC.map((d) => ({ rot: d.toLowerCase(), v: contar(l, (o) => o.doc === d), cor: COR.doc[d] })),
      total: l.length, max, ativo: estado.site === id, apagado: estado.site && estado.site !== id,
      acao: () => alternar('site', id),
    })));
    // há quanto tempo a obra terminou e a documentação segue em aberto
    const antigas = concl.filter((o) => docPendente(o) && o.data != null).sort((a, b) => a.data - b.data).slice(0, 3);
    $('doc-antigas').replaceChildren(...(antigas.length ? [
      h('h3', null, 'Concluídas há mais tempo sem documentação aprovada'),
      h('ul', { class: 'radar' }, antigas.map((o) => {
        const btn = h('button', { type: 'button', onclick: () => focarObra(o.id) },
          h('span', { class: 'pt ic', style: `background:${COR.doc[o.doc]}`, 'aria-hidden': 'true' }),
          h('span', { class: 't' }, o.tap),
          h('span', { class: 'q' }, `há ${plural(Math.round((hoje - o.data) / DIA), 'dia', 'dias')}`),
          h('span', { class: 'p' }, nomeProjeto(o)),
          h('span', { class: 'm' }, `${o.site} · concluída em ${fmtData(o.data)} · ${o.doc.toLowerCase()}`));
        ligarTip(btn, () => [...tipObra(o), ttSep(), ttTxt(o.obs || 'Sem observações')]);
        return h('li', null, btn);
      })),
    ] : []));
  }

  function renderRanking(idCont, campo) {
    const base = filtradas(campo);
    const grupos = [...agrupar(base, (o) => o[campo])].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR'));
    const max = Math.max(0, ...grupos.map((g) => g[1].length));
    const cont = $(idCont);
    if (!grupos.length) { cont.replaceChildren(h('p', { class: 'vazio' }, 'Nenhuma obra no filtro.')); return; }
    cont.replaceChildren(...grupos.map(([nome, l]) => {
      const ne = contar(l, (o) => o.emergencial === true);
      return linhaBarra({
        nome, segmentos: [{ rot: l.length === 1 ? 'obra' : 'obras', v: l.length, cor: COR.serie }],
        total: l.length, max, ativo: estado[campo] === nome, apagado: estado[campo] && estado[campo] !== nome,
        acao: () => alternar(campo, nome),
        tip: () => [
          ttTit(nome),
          campo === 'empresa' ? ttTxt([...new Set(l.map((o) => o.empresaCompleta).filter(Boolean))].join(' · ')) : null,
          ttLin(l.length, l.length === 1 ? ' obra' : ' obras'),
          ttLin(ne, ne === 1 ? ' emergencial' : ' emergenciais', COR.emerg),
          ttLin(contar(l, ativa), ' em execução ou a iniciar'),
        ].filter(Boolean),
      });
    }));
  }

  // ---------- radar de prazos ----------
  function renderRadar(lista) {
    const itens = [];
    for (const o of lista) {
      const p = prazo(o);
      if (p.tipo === 'atrasada') itens.push({ o, p, g: 0, k: -p.dias });
      else if (p.tipo === 'vence30') itens.push({ o, p, g: 1, k: p.dias });
      else if (o.status === 'A iniciar' && p.tipo === 'noprazo' && p.dias <= 60) itens.push({ o, p, g: 2, k: p.dias });
    }
    itens.sort((a, b) => a.g - b.g || a.k - b.k);
    const cont = $('radar');
    if (!itens.length) {
      cont.replaceChildren(h('li', { class: 'vazio' }, 'Nenhuma obra atrasada ou vencendo nos próximos 30 dias no filtro.'));
      return;
    }
    const LIMITE = 8;
    cont.replaceChildren(...itens.slice(0, LIMITE).map(({ o, p, g }) => {
      const cor = g === 0 ? COR.atraso : g === 1 ? COR.vence : COR.status['A iniciar'];
      const quando = g === 2 ? `a iniciar · ${textoPrazo(p)}` : textoPrazo(p);
      const btn = h('button', { type: 'button', onclick: () => focarObra(o.id) },
        h('span', { class: 'pt ic', style: `background:${cor}`, 'aria-hidden': 'true' }),
        h('span', { class: 't' }, o.tap, ' ', o.emergencial ? h('span', { class: 'selo-e', title: 'Emergencial', 'aria-label': 'emergencial' }, '!') : null),
        h('span', { class: 'q' }, quando),
        h('span', { class: 'p' }, nomeProjeto(o)),
        h('span', { class: 'm' }, `${o.site} · ${o.gestor}${o.emergencial ? ' · emergencial' : ''}`));
      ligarTip(btn, () => tipObra(o));
      return h('li', null, btn);
    }));
    if (itens.length > LIMITE) cont.append(h('li', { class: 'vazio' }, `e mais ${itens.length - LIMITE} na lista de obras`));
  }

  // ---------- linha do tempo ----------
  function renderTimeline(lista) {
    const cont = $('timeline');
    const comData = lista.filter((o) => o.data != null);
    const semData = lista.length - comData.length;
    $('tl-nota').textContent = semData ? `${plural(semData, 'obra sem data de conclusão não aparece', 'obras sem data de conclusão não aparecem')} na linha do tempo.` : '';
    if (!comData.length) { cont.replaceChildren(h('p', { class: 'vazio' }, 'Nenhuma obra com data no filtro.')); return; }

    const W = Math.max(320, cont.clientWidth || 900);
    const estreito = W < 640;
    const esq = estreito ? 96 : 160, dir = estreito ? 12 : 24, topo = 30, alt = estreito ? 52 : 50, rodape = 26;
    const linhas = [...agrupar(comData, (o) => o.siteId)].map(([id, l]) => ({ id, l, regional: l[0].regional, site: l[0].site }))
      .sort((a, b) => a.regional.localeCompare(b.regional, 'pt-BR') || b.l.length - a.l.length || a.site.localeCompare(b.site, 'pt-BR'));
    const H = topo + linhas.length * alt + rodape;
    const datas = comData.map((o) => o.data);
    const d0 = Math.min(...datas, hoje) - 25 * DIA;
    const d1 = Math.max(...datas, hoje + 30 * DIA) + 25 * DIA;
    const x = (ms) => esq + ((ms - d0) / (d1 - d0)) * (W - esq - dir);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'group', 'aria-label': 'Linha do tempo das conclusões por site' });
    const yTopo = topo, yBase = topo + linhas.length * alt;
    // próximos 30 dias
    svg.append(s('rect', { x: x(hoje), y: yTopo, width: x(hoje + 30 * DIA) - x(hoje), height: yBase - yTopo, fill: COR.amareloClaro }));
    // meses
    const inicio = new Date(d0);
    let mes = Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1);
    const pxMes = (30.4 * DIA * (W - esq - dir)) / (d1 - d0);
    const passo = [1, 2, 3, 6, 12].find((p) => p * pxMes >= (estreito ? 56 : 64)) || 12;
    let i = 0;
    while (mes < d1) {
      const d = new Date(mes);
      if (d.getUTCMonth() % passo === 0) {
        const xm = x(mes);
        svg.append(s('line', { x1: xm, x2: xm, y1: yTopo, y2: yBase, stroke: COR.cinzaClaro, 'stroke-width': 1 }));
        svg.append(s('text', { x: xm + 3, y: H - 8, 'font-size': 11 }, fmtMes(mes)));
      }
      mes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      if (++i > 400) break;
    }
    // linhas por site
    linhas.forEach((ln, k) => {
      const y0 = yTopo + k * alt;
      svg.append(s('line', { x1: 0, x2: W, y1: y0 + alt, y2: y0 + alt, stroke: COR.cinzaClaro, 'stroke-width': 1 }));
      svg.append(s('text', { x: 0, y: y0 + alt / 2 - 2, 'font-size': 13, 'font-weight': 700 }, ln.site));
      svg.append(s('text', { x: 0, y: y0 + alt / 2 + 13, 'font-size': 11 }, `${ln.regional.replace('Paraopeba ', 'P. ')} · ${plural(ln.l.length, 'obra', 'obras')}`));
    });
    svg.append(s('line', { x1: esq, x2: W - dir, y1: yBase, y2: yBase, stroke: COR.cinzaMedio, 'stroke-width': 1 }));
    // hoje
    const xh = x(hoje);
    svg.append(s('line', { x1: xh, x2: xh, y1: yTopo - 8, y2: yBase, stroke: COR.verdeEscuro, 'stroke-width': 1.5 }));
    const perto = xh + 90 > W;
    svg.append(s('text', { x: perto ? xh - 4 : xh + 4, y: yTopo - 12, 'font-size': 12, 'font-weight': 700, 'text-anchor': perto ? 'end' : 'start' }, `Hoje · ${fmtData(hoje).slice(0, 5)}`));

    // pontos (deslocamento vertical quando datas colidem)
    const OFF = [0, -12, 12, -24, 24];
    const rotulos = [];
    linhas.forEach((ln, k) => {
      const yc = yTopo + k * alt + alt / 2;
      const ocupado = OFF.map(() => []);
      for (const o of [...ln.l].sort((a, b) => a.data - b.data)) {
        const cx = x(o.data);
        let faixa = OFF.findIndex((_, f) => ocupado[f].every((px) => Math.abs(px - cx) >= 13));
        if (faixa < 0) faixa = 0;
        ocupado[faixa].push(cx);
        const cy = yc + OFF[faixa];
        const concluida = o.status === 'Concluída';
        const cor = corEmerg(o);
        const g = s('g', { tabindex: 0, role: 'button', 'aria-label': `${o.tap}, ${nomeProjeto(o)}, ${fmtData(o.data)}, ${o.status}`, style: 'cursor:pointer;outline:none' },
          s('circle', { cx, cy, r: 12, fill: 'transparent' }),
          concluida
            ? s('circle', { cx, cy, r: 5, fill: '#fff', stroke: cor, 'stroke-width': 2.5 })
            : s('circle', { cx, cy, r: 6.5, fill: cor, stroke: '#fff', 'stroke-width': 2 }));
        ligarTip(g, () => tipObra(o));
        g.addEventListener('click', () => focarObra(o.id));
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focarObra(o.id); } });
        svg.append(g);
        const p = prazo(o);
        if (p.tipo === 'atrasada') rotulos.push({ cx, cy, texto: `${o.tap} · ${textoPrazo(p)}` });
      }
    });
    // rótulo direto só para atrasadas (o que exige ação)
    for (const r of rotulos) {
      const t = s('text', { x: r.cx - 10, y: r.cy - 12, 'font-size': 12, 'font-weight': 700, 'text-anchor': 'end', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, r.texto);
      svg.append(t);
    }
    cont.replaceChildren(svg);
  }

  // ---------- lista de obras ----------
  const COLUNAS = [
    { id: 'tap', rot: 'TAP', txt: (o) => o.tap },
    { id: 'projeto', rot: 'Projeto', txt: (o) => o.projeto || '~' },
    { id: 'site', rot: 'Site', txt: (o) => o.site },
    { id: 'empresa', rot: 'Empresa', txt: (o) => o.empresa },
    { id: 'gestor', rot: 'Gestor Vale', txt: (o) => o.gestor },
    { id: 'data', rot: 'Conclusão', num: (o) => (o.data == null ? Infinity : o.data) },
    { id: 'prazo', rot: 'Prazo', cmp: cmpPrazo },
    { id: 'status', rot: 'Status', num: (o) => { const i = ORDEM_STATUS.indexOf(o.status); return i < 0 ? 9 : i; } },
    { id: 'emergencial', rot: 'Emergencial', num: (o) => (o.emergencial === true ? 0 : o.emergencial === false ? 1 : 2) },
    { id: 'doc', rot: 'Documentação', num: (o) => ORDEM_DOC.indexOf(o.doc) },
  ];
  function cmpPrazo(a, b) {
    const pa = prazo(a), pb = prazo(b);
    const grupo = { atrasada: 0, vence30: 1, noprazo: 2, semdata: 3, concluida: 4 };
    if (grupo[pa.tipo] !== grupo[pb.tipo]) return grupo[pa.tipo] - grupo[pb.tipo];
    if (pa.tipo === 'atrasada') return pb.dias - pa.dias;
    if (pa.tipo === 'concluida') return (b.data ?? 0) - (a.data ?? 0);
    return (a.data ?? 0) - (b.data ?? 0);
  }
  function ordenar(lista) {
    const col = COLUNAS.find((c) => c.id === ordem.coluna);
    const base = (a, b) => cmpPrazo(a, b) || a.tap.localeCompare(b.tap, 'pt-BR', { numeric: true });
    if (!col) return [...lista].sort(base);
    const cmp = col.cmp || (col.num ? (a, b) => col.num(a) - col.num(b) : (a, b) => col.txt(a).localeCompare(col.txt(b), 'pt-BR', { numeric: true }));
    return [...lista].sort((a, b) => cmp(a, b) * ordem.dir || base(a, b));
  }

  function celulaPrazo(o) {
    const p = prazo(o);
    if (p.tipo === 'concluida') return h('span', { 'aria-label': 'concluída' }, '—');
    if (p.tipo === 'atrasada') return h('span', { class: 'rot-st' }, h('span', { class: 'pt', style: `background:${COR.atraso}` }), h('b', null, textoPrazo(p)));
    if (p.tipo === 'vence30') return h('span', { class: 'rot-st' }, h('span', { class: 'pt', style: `background:${COR.vence}` }), textoPrazo(p));
    return h('span', null, textoPrazo(p));
  }
  const celulaPonto = (cor, texto) => h('span', { class: 'rot-st' }, h('span', { class: 'pt', style: `background:${cor}` }), texto);

  function renderTabela(lista) {
    const ordenada = ordenar(lista);
    $('lista-desc').textContent = `${plural(ordenada.length, 'obra', 'obras')} no filtro · clique em uma linha para ver as observações`;
    const thead = h('thead', null, h('tr', null, COLUNAS.map((c) => h('th', {
      scope: 'col', 'aria-sort': ordem.coluna === c.id ? (ordem.dir === 1 ? 'ascending' : 'descending') : null,
    }, h('button', {
      type: 'button',
      onclick: () => {
        if (ordem.coluna === c.id) ordem.dir *= -1; else { ordem.coluna = c.id; ordem.dir = 1; }
        renderTabela(filtradas());
      },
    }, c.rot)))));
    const tbody = h('tbody');
    for (const o of ordenada) {
      const aberta = abertas.has(o.id);
      const tr = h('tr', { class: 'obra', 'data-id': o.id, tabindex: 0, 'aria-expanded': String(aberta) },
        h('td', { class: 'tap' }, o.tap || '—'),
        h('td', null, o.projeto || h('span', { class: 'proj-rev' }, '⚠ Descrição a revisar na base')),
        h('td', null, o.site),
        h('td', null, o.empresa),
        h('td', null, o.gestor),
        h('td', { class: 'num' }, fmtData(o.data)),
        h('td', null, celulaPrazo(o)),
        h('td', null, celulaPonto(corStatus(o.status), o.status)),
        h('td', null, o.emergencial === true ? h('span', { class: 'rot-st' }, h('span', { class: 'selo-e', 'aria-hidden': 'true' }, '!'), 'Sim')
          : o.emergencial === false ? h('span', { class: 'rot-st' }, h('span', { class: 'pt-n', 'aria-hidden': 'true' }), 'Não') : '—'),
        h('td', null, celulaPonto(COR.doc[o.doc], o.doc)));
      const alternarDetalhe = () => { if (abertas.has(o.id)) abertas.delete(o.id); else abertas.add(o.id); renderTabela(filtradas()); };
      tr.addEventListener('click', alternarDetalhe);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarDetalhe(); } });
      tbody.append(tr);
      if (aberta) {
        tbody.append(h('tr', { class: 'detalhe' }, h('td', { colspan: COLUNAS.length }, h('dl', null,
          h('dt', null, 'Observações'), h('dd', null, o.obs || 'Sem observações registradas.'),
          h('dt', null, 'Situação documental'), h('dd', null, `${o.doc} (lida automaticamente das observações)`),
          h('dt', null, 'Regional'), h('dd', null, o.regional),
          h('dt', null, 'Empresa (razão social)'), h('dd', null, o.empresaCompleta || 'Não definida'),
          h('dt', null, 'Origem na planilha'), h('dd', null, `Aba ${o.aba}, linha ${o.linha}`),
          o.projetoInvalido ? [h('dt', null, 'Atenção'), h('dd', null, 'O campo Projeto desta linha não descreve a obra. Corrija a descrição na planilha.')] : null,
        ))));
      }
    }
    if (!ordenada.length) tbody.append(h('tr', null, h('td', { colspan: COLUNAS.length, class: 'vazio' }, 'Nenhuma obra no filtro.')));
    $('tabela').replaceChildren(thead, tbody);
  }

  function focarObra(id) {
    abertas.add(id);
    renderTabela(filtradas());
    const tr = document.querySelector(`tr.obra[data-id="${id}"]`);
    if (!tr) return;
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tr.classList.remove('foco');
    void tr.offsetWidth;
    tr.classList.add('foco');
    tr.focus({ preventScroll: true });
  }

  function exportarCsv() {
    const linhas = ordenar(filtradas());
    const cab = ['Regional', 'TAP', 'Projeto', 'Site', 'Empresa', 'Empresa (razão social)', 'Gestor Vale', 'Data conclusão', 'Status', 'Emergencial', 'Prazo', 'Situação documental', 'Observações'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const corpo = linhas.map((o) => [o.regional, o.tap, o.projeto || 'Descrição a revisar', o.site, o.empresa, o.empresaCompleta, o.gestor, fmtData(o.data), o.status,
      o.emergencial === true ? 'Sim' : o.emergencial === false ? 'Não' : '', textoPrazo(prazo(o)), o.doc, o.obs].map(q).join(';'));
    const blob = new Blob(['﻿' + [cab.map(q).join(';'), ...corpo].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `obras-implantacao-${new Date(hoje).toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- qualidade da base ----------
  function renderAvisos() {
    const total = avisos.reduce((n, a) => n + a.itens.length, 0);
    $('qualidade-tit').textContent = total ? `Qualidade da base · ${plural(total, 'ponto de atenção', 'pontos de atenção')}` : 'Qualidade da base · nenhum ponto de atenção';
    $('avisos').replaceChildren(...avisos.map((a) => h('div', { class: 'aviso' },
      h('h3', null, a.titulo), h('ul', null, a.itens.map((i) => h('li', null, i))), a.dica ? h('p', null, a.dica) : null)));
  }

  // ---------- ciclo de renderização ----------
  function render() {
    const lista = filtradas();
    sincronizarFiltros();
    renderAtivos();
    renderKpis(lista);
    renderMapa();
    renderSites();
    renderRadar(lista);
    renderTimeline(lista);
    renderDoc(lista);
    renderRanking('graf-empresas', 'empresa');
    renderRanking('graf-gestores', 'gestor');
    renderTabela(lista);
  }

  // ---------- carga da planilha ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  async function carregar(buffer, nome, origem) {
    document.body.classList.add('carregando');
    try {
      const abas = await LeitorXlsx.ler(buffer);
      const r = Dados.interpretar(abas);
      if (!r.obras.length) throw new Error('nenhuma obra encontrada. Confira se as abas têm o cabeçalho com TAP e Projeto.');
      obras = r.obras;
      avisos = r.avisos;
      Object.assign(estado, PADRAO);
      abertas.clear();
      const quando = origem === 'embutida'
        ? `cópia de ${fmtData(Date.parse(BASE.data))}`
        : `carregada em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
      $('fonte').replaceChildren(h('b', null, plural(obras.length, 'obra', 'obras')), ` · base ${quando}`, h('br'), `Prazos calculados para hoje, ${fmtData(hoje)}`);
      $('fonte').title = nome;
      montarFiltros();
      renderAvisos();
      render();
      if (origem !== 'embutida') toast(`Painel atualizado: ${plural(obras.length, 'obra lida', 'obras lidas')} de "${nome}".`);
    } catch (e) {
      console.error(e);
      toast(`Não foi possível ler a planilha: ${e.message}`);
    } finally {
      document.body.classList.remove('carregando');
    }
  }

  function lerArquivo(arquivo) {
    if (!arquivo) return;
    if (!/\.xlsx$/i.test(arquivo.name)) { toast('Use o arquivo .xlsx baixado do SharePoint.'); return; }
    arquivo.arrayBuffer().then((buf) => carregar(buf, arquivo.name, 'upload'));
  }

  function iniciar() {
    $('btn-carregar').addEventListener('click', () => $('arquivo').click());
    $('arquivo').addEventListener('change', (e) => { lerArquivo(e.target.files[0]); e.target.value = ''; });
    $('btn-csv').addEventListener('click', exportarCsv);
    const soltar = $('soltar');
    let profundidade = 0;
    addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { profundidade++; soltar.hidden = false; } });
    addEventListener('dragleave', () => { profundidade = Math.max(0, profundidade - 1); if (!profundidade) soltar.hidden = true; });
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', (e) => { e.preventDefault(); profundidade = 0; soltar.hidden = true; lerArquivo(e.dataTransfer.files[0]); });
    let espera;
    addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => renderTimeline(filtradas()), 150); });

    iniciarMapa();
    const bin = atob(BASE.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    carregar(bytes.buffer, BASE.nome, 'embutida');
  }

  iniciar();
})();
