// ANIMAXA — backup periódico do catálogo (reserva pra quando o Firestore
// estourar a cota)
//
// Problema que isso resolve: o plano gratuito (Spark) do Firebase dá 50 mil
// leituras/dia no Firestore. Se o site tomar um pico de acesso (ou o
// Googlebot rastrear demais) e estourar essa cota, TODAS as leituras
// passam a falhar até a cota resetar — ou seja, o catálogo inteiro do
// site (index, catalogo, explore, páginas de anime/série/filme) para de
// carregar pros visitantes.
//
// Esta função roda sozinha no servidor (Scheduled Function do Netlify),
// de 6 em 6 horas, lê as 5 coleções do catálogo (animes, episodes, series,
// seriesEpisodes, movies) e guarda uma cópia completa (todos os campos,
// não só os usados no sitemap) no Netlify Blobs. A função HTTP irmã
// (catalogo-backup.mjs) serve essa cópia pra quem pedir — o site troca
// pra ela sozinho quando o Firestore falhar (ver assets/firebase-client.js).
//
// Se o Firestore falhar nessa execução (ex: cota já estourada agora), a
// função NÃO apaga o backup anterior — só loga o erro e tenta de novo na
// próxima execução, 6h depois. Assim o backup nunca fica vazio por causa
// de uma falha pontual, e nunca é ele mesmo a causa de mais leituras
// (roda só a cada 6h, não a cada visita).

import { schedule } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PROJECT_ID = "anima-65cc3";
const API_KEY = "AIzaSyDXwUdq1SIQdwqsWJZc5wq0KTqpN9V9Cs0";
const FIRESTORE_DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Coleções que compõem o catálogo. Sem mask.fieldPaths aqui de propósito
// (diferente do gerar-sitemaps): o backup precisa de TODOS os campos —
// título, sinopse, capa, gêneros, videoUrl etc — não só das datas.
const COLECOES = ["animes", "episodes", "series", "seriesEpisodes", "movies"];

// Converte um valor no formato "Firestore REST" (ex: {stringValue: "x"})
// pro valor JS puro equivalente. Documentação do formato:
// https://firebase.google.com/docs/firestore/reference/rest/v1/Value
function valorParaJs(valor) {
  if (valor == null) return null;
  if ("stringValue" in valor) return valor.stringValue;
  if ("integerValue" in valor) return Number(valor.integerValue);
  if ("doubleValue" in valor) return valor.doubleValue;
  if ("booleanValue" in valor) return valor.booleanValue;
  if ("nullValue" in valor) return null;
  if ("timestampValue" in valor) return valor.timestampValue; // já vem em ISO 8601
  if ("referenceValue" in valor) return valor.referenceValue.split("/").pop();
  if ("arrayValue" in valor) {
    return (valor.arrayValue.values || []).map(valorParaJs);
  }
  if ("mapValue" in valor) {
    return camposParaJs(valor.mapValue.fields || {});
  }
  return null;
}

function camposParaJs(fields) {
  const obj = {};
  for (const [chave, valor] of Object.entries(fields)) {
    obj[chave] = valorParaJs(valor);
  }
  return obj;
}

async function listarColecao(colecao) {
  const docs = [];
  let pageToken;
  do {
    const url = new URL(`${FIRESTORE_DOCS}/${colecao}`);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      throw new Error(
        `Firestore respondeu ${res.status} ${res.statusText} para "${colecao}": ${corpo.slice(0, 300)}`
      );
    }
    const json = await res.json();
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken;
  } while (pageToken);

  // Cada doc vira {id, ...campos}, igual ao formato que o SDK do cliente
  // já devolve (snap.docs.map(d => ({id: d.id, ...d.data()}))) — assim a
  // função de fallback e o firebase-client.js não precisam saber que os
  // dados vieram de um backup e não do SDK.
  return docs.map((doc) => ({
    id: doc.name.split("/").pop(),
    ...camposParaJs(doc.fields || {}),
  }));
}

export const handler = schedule("0 */6 * * *", async () => {
  const store = getStore("catalogo-backup");
  const resultado = {};
  let algumaFalha = false;

  for (const colecao of COLECOES) {
    try {
      const docs = await listarColecao(colecao);
      await store.setJSON(colecao, docs);
      resultado[colecao] = docs.length;
      console.log(`[backup-catalogo] ${colecao}: ${docs.length} documento(s) salvos.`);
    } catch (err) {
      algumaFalha = true;
      console.error(`[backup-catalogo] Falha ao salvar "${colecao}":`, err.message);
      // Mantém o backup anterior dessa coleção — não sobrescreve com
      // vazio. Segue tentando as outras coleções normalmente.
    }
  }

  // Só atualiza o "geradoEm" global se pelo menos uma coleção teve
  // sucesso — assim dá pra saber, olhando o meta, se o backup como um
  // todo está fresco ou parcialmente desatualizado.
  await store.setJSON("meta", {
    geradoEm: new Date().toISOString(),
    contagens: resultado,
    completo: !algumaFalha,
  });

  // Sempre 200: Netlify não re-tenta scheduled functions, e cada erro
  // por coleção já foi logado acima individualmente.
  return { statusCode: 200 };
});
