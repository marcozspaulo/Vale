// Confere a sintaxe de uma consulta Power Query (M) com o parser oficial da Microsoft.
// Uso: node powerbi/validar_m.mjs consulta.pq   (sai com código 1 se houver erro)
import { readFileSync } from 'node:fs';
import { DefaultSettings, TaskUtils } from '@microsoft/powerquery-parser';

const texto = readFileSync(process.argv[2], 'utf8');
const resultado = await TaskUtils.tryLexParse(DefaultSettings, texto);
if (TaskUtils.isParseStageOk(resultado)) process.exit(0);
const erro = resultado.error;
console.log(erro?.message ?? JSON.stringify(erro)?.slice(0, 400) ?? 'erro de sintaxe');
process.exit(1);
