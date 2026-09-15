import { list } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: 'resultados/' });

    // Cada blob guarda um JSON com os dados da sessão - busca o conteúdo
    // de cada um (a listagem do Blob só dá metadados, não o conteúdo).
    const resultados = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const resposta = await fetch(blob.url);
          return await resposta.json();
        } catch {
          return null;
        }
      })
    );

    const validos = resultados.filter(Boolean);
    validos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({ resultados: validos });
  } catch (erro) {
    console.error('[api/listar-resultados] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
