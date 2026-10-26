// Leitor mínimo de .xlsx (ZIP + XML) usando só APIs nativas do navegador
// (DecompressionStream e DOMParser). Devolve as abas com suas linhas de valores brutos.
const LeitorXlsx = (() => {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  async function inflar(dados) {
    const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  function abrirZip(buffer) {
    const b = new Uint8Array(buffer);
    let fim = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) {
      throw new Error('o arquivo não é um .xlsx válido. Se ele tiver rótulo de confidencialidade com criptografia ou senha, salve uma cópia sem proteção e tente de novo.');
    }
    const decod = new TextDecoder();
    const entradas = new Map();
    let p = u32(b, fim + 16);
    for (let k = 0, total = u16(b, fim + 10); k < total; k++) {
      if (u32(b, p) !== 0x02014b50) throw new Error('estrutura interna do .xlsx corrompida.');
      const metodo = u16(b, p + 10);
      const tamanho = u32(b, p + 20);
      const nLen = u16(b, p + 28), xLen = u16(b, p + 30), cLen = u16(b, p + 32);
      const local = u32(b, p + 42);
      const nome = decod.decode(b.subarray(p + 46, p + 46 + nLen));
      const ini = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      entradas.set(nome, { metodo, dados: b.subarray(ini, ini + tamanho) });
      p += 46 + nLen + xLen + cLen;
    }
    return async (nome) => {
      const e = entradas.get(nome);
      if (!e) return null;
      if (e.metodo === 0) return decod.decode(e.dados);
      if (e.metodo === 8) return decod.decode(await inflar(e.dados));
      throw new Error('compressão não suportada no .xlsx.');
    };
  }

  const xml = (texto) => new DOMParser().parseFromString(texto, 'application/xml');
  const tags = (no, nome) => Array.from(no.getElementsByTagNameNS('*', nome));

  function colunaIndice(ref) {
    let n = 0;
    for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function textoRico(no) {
    // concatena os <t> do item, ignorando a transcrição fonética (<rPh>)
    return tags(no, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('');
  }

  async function ler(buffer) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('este navegador não consegue abrir .xlsx. Use o Edge ou o Chrome atualizados.');
    }
    const arquivo = abrirZip(buffer);
    const wb = await arquivo('xl/workbook.xml');
    if (!wb) throw new Error('o arquivo não parece ser uma planilha do Excel.');
    const rels = xml((await arquivo('xl/_rels/workbook.xml.rels')) || '<Relationships/>');
    const alvo = {};
    for (const r of tags(rels, 'Relationship')) {
      const t = r.getAttribute('Target');
      alvo[r.getAttribute('Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    }
    const compartilhadas = [];
    const ss = await arquivo('xl/sharedStrings.xml');
    if (ss) for (const si of tags(xml(ss), 'si')) compartilhadas.push(textoRico(si));

    const abas = [];
    for (const s of tags(xml(wb), 'sheet')) {
      const id = s.getAttributeNS(NS_REL, 'id') || s.getAttribute('r:id');
      const conteudo = await arquivo(alvo[id]);
      const linhas = [];
      if (conteudo) {
        for (const row of tags(xml(conteudo), 'row')) {
          const valores = [];
          for (const c of tags(row, 'c')) {
            const tipo = c.getAttribute('t');
            const v = tags(c, 'v')[0];
            let valor = null;
            if (tipo === 's') valor = v ? compartilhadas[+v.textContent] ?? null : null;
            else if (tipo === 'inlineStr') valor = textoRico(c);
            else if (tipo === 'b') valor = v ? v.textContent === '1' : null;
            else if (tipo === 'str' || tipo === 'e') valor = v ? v.textContent : null;
            else if (v) valor = Number(v.textContent);
            const ref = c.getAttribute('r');
            valores[ref ? colunaIndice(ref) : valores.length] = valor;
          }
          linhas.push({ numero: +row.getAttribute('r'), valores });
        }
      }
      abas.push({ nome: s.getAttribute('name'), oculta: (s.getAttribute('state') || 'visible') !== 'visible', linhas });
    }
    return abas;
  }

  return { ler };
})();
