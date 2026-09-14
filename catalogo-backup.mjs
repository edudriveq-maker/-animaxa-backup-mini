// ANIMAXA — endpoint que serve o backup do catálogo (Netlify Blobs)
//
// Só LÊ o que a função agendada (backup-catalogo.mjs) já guardou — nunca
// consulta o Firestore. É o que assets/firebase-client.js chama quando
// uma leitura no Firestore falha (cota estourada, projeto fora do ar,
// etc), pra o site continuar mostrando o catálogo mesmo sem o banco
// principal responder.
//
// Devolve as 5 coleções de uma vez (o catálogo inteiro costuma ser
// pequeno o bastante pra isso ser mais simples e barato do que ter uma
// rota por coleção): { animes, episodes, series, seriesEpisodes, movies, meta }.

import { getStore } from "@netlify/blobs";

const COLECOES = ["animes", "episodes", "series", "seriesEpisodes", "movies"];

export default async () => {
  try {
    const store = getStore("catalogo-backup");

    const [listas, meta] = await Promise.all([
      Promise.all(COLECOES.map((colecao) => store.get(colecao, { type: "json" }))),
      store.get("meta", { type: "json" }),
    ]);

    const corpo = { meta: meta || null };
    COLECOES.forEach((colecao, i) => {
      corpo[colecao] = listas[i] || [];
    });

    return new Response(JSON.stringify(corpo), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Cache curto: é uma reserva de emergência, não precisa ficar
        // preso em CDN por muito tempo, mas evita bater no Blobs a cada
        // requisição se o Firestore cair pra todo mundo ao mesmo tempo.
        "Cache-Control": "public, max-age=120",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[catalogo-backup] erro ao servir backup:", err);
    return new Response(
      JSON.stringify({ erro: "Backup indisponível", detalhe: err.message }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};
