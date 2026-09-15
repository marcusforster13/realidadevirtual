import { list } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: 'evidencias/' });

    const evidencias = blobs.map((blob) => {
      const nomeArquivo = blob.pathname.split('/').pop().replace('.png', '');
      const [id, hash] = nomeArquivo.split('__');

      return {
        id: id || nomeArquivo,
        hash: hash || null,
        // O Vercel Blob já guarda a data real do upload - não precisa
        // extrair isso do nome do arquivo.
        timestamp: blob.uploadedAt,
        url: blob.url,
      };
    });

    // Mais recentes primeiro.
    evidencias.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({ evidencias });
  } catch (erro) {
    console.error('[api/list] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
