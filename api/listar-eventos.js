import { list } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const { sessaoId } = req.query;
    if (!sessaoId) {
      res.status(400).json({ error: 'Faltou o parâmetro sessaoId' });
      return;
    }

    const { blobs } = await list({ prefix: `eventos/${sessaoId}/` });

    const eventos = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const resposta = await fetch(blob.url);
          return await resposta.json();
        } catch {
          return null;
        }
      })
    );

    const validos = eventos.filter(Boolean);
    validos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.status(200).json({ eventos: validos });
  } catch (erro) {
    console.error('[api/listar-eventos] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
