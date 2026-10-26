// Cadastro dos sites do Complexo Paraopeba.
// As coordenadas são APROXIMADAS (centro operacional de cada mina, conferido contra a
// malha municipal do IBGE). Para ajustar um ponto, troque lat/lon aqui e rode o build.
// "apelidos" são as grafias aceitas na coluna Site da planilha (sem acento, maiúsculas).
// "rotulo" define de que lado da bolha o nome aparece no mapa (evita sobreposição).
const SITES = [
  { id: 'mutuca',   nome: 'Mutuca',            municipio: 'Nova Lima',  lat: -20.030,  lon: -43.968,  rotulo: 'direita',
    apelidos: ['MUTUCA', 'MINA DE MUTUCA', 'MINA MUTUCA'] },
  { id: 'cpx',      nome: 'Capão Xavier',      municipio: 'Nova Lima',  lat: -20.046,  lon: -43.985,  rotulo: 'esquerda',
    apelidos: ['CPX', 'CAPAO XAVIER', 'MINA CAPAO XAVIER', 'MINA DE CAPAO XAVIER'] },
  { id: 'marazul',  nome: 'Mar Azul',          municipio: 'Nova Lima',  lat: -20.115,  lon: -43.970,  rotulo: 'direita',
    apelidos: ['MAR AZUL', 'MINA MAR AZUL', 'MINA DE MAR AZUL'] },
  { id: 'feijao',   nome: 'Córrego do Feijão', municipio: 'Brumadinho', lat: -20.129,  lon: -44.110,  rotulo: 'esquerda',
    apelidos: ['FEIJAO', 'CORREGO DO FEIJAO', 'MINA CORREGO DO FEIJAO', 'CFJ'] },
  { id: 'fabrica',  nome: 'Fábrica',           municipio: 'Ouro Preto', lat: -20.4135, lon: -43.8814, rotulo: 'esquerda',
    apelidos: ['FABRICA', 'MINA DE FABRICA', 'MINA FABRICA'] },
  { id: 'viga',     nome: 'Viga',              municipio: 'Congonhas',  lat: -20.455,  lon: -43.835,  rotulo: 'direita',
    apelidos: ['VIGA', 'MINA DE VIGA', 'MINA VIGA'] },
];
