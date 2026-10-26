// Gera o painel em um único arquivo HTML (sem dependências externas obrigatórias).
// Uso: node painel/build.mjs [planilha.xlsx] [saida.html]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const ler = (...p) => readFileSync(join(...p), 'utf8');

const pastaDados = join(raiz, 'dados');
const recente = readdirSync(pastaDados).filter((f) => f.toLowerCase().endsWith('.xlsx'))
  .sort((a, b) => statSync(join(pastaDados, b)).mtimeMs - statSync(join(pastaDados, a)).mtimeMs)[0];
const planilha = process.argv[2] || (recente && join(pastaDados, recente));
if (!planilha) {
  console.error('Nenhuma planilha encontrada. Coloque o .xlsx em painel/dados/ ou passe o caminho: node painel/build.mjs planilha.xlsx');
  process.exit(1);
}
const saida = process.argv[3] || join(raiz, 'painel-obras-implantacao-2026.html');

// impede que conteúdo embutido feche a tag <script> antes da hora
const seguroJs = (t) => t.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const leaflet = join(raiz, '..', 'node_modules', 'leaflet', 'dist');
const base = {
  nome: basename(planilha),
  data: new Date().toISOString().slice(0, 10),
  b64: readFileSync(planilha).toString('base64'),
};
const js = ['sites.js', 'leitor-xlsx.js', 'dados.js', 'app.js'].map((f) => ler(raiz, 'src', f)).join('\n');

const html = ler(raiz, 'src', 'index.html')
  .replace('/*{{LEAFLET_CSS}}*/', () => ler(leaflet, 'leaflet.css'))
  .replace('/*{{CSS}}*/', () => ler(raiz, 'src', 'estilo.css'))
  .replace('/*{{LEAFLET_JS}}*/', () => seguroJs(ler(leaflet, 'leaflet.js')))
  .replace('/*{{DADOS}}*/', () => `const BASE = ${json(base)};\nconst GEO = ${ler(raiz, 'geo', 'municipios.json').replace(/</g, '\\u003c')};`)
  .replace('/*{{JS}}*/', () => seguroJs(js));

writeFileSync(saida, html);
console.log(`Painel gerado: ${saida} (${(html.length / 1024).toFixed(0)} KB) a partir de ${basename(planilha)}`);
