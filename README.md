# animaxa-backup-mini

Deploy separado (Netlify) só com as functions de backup do catálogo,
pra o bot do Telegram consultar. Não tem nenhuma página — é normal a
URL raiz dar 404, o que importa é:

  /.netlify/functions/catalogo-backup   -> devolve o JSON do catálogo
  /.netlify/functions/backup-catalogo   -> roda sozinha a cada 6h (scheduled)

Depois do primeiro deploy, invoque backup-catalogo manualmente uma vez
(aba Functions no painel da Netlify) pra não esperar 6h.
