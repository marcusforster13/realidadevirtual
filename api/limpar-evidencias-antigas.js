import { list, del } from '@vercel/blob';

// Quantos dias uma evidência fica guardada antes de ser apagada
// automaticamente. Ajuste esse número como preferir.
const DIAS_PARA_MANTER = 30;

export default async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: 'evidencias/' });

    const agora = Date.now();
    const limiteMs = DIAS_PARA_MANTER * 24 * 60 * 60 * 1000;

    const paraApagar = blobs.filter((blob) => {
      const idadeMs = agora - new Date(blob.uploadedAt).getTime();
      return idadeMs > limiteMs;
    });

    if (paraApagar.length > 0) {
      await del(paraApagar.map((b) => b.url));
    }

    console.log(`[limpeza] ${paraApagar.length} evidência(s) antiga(s) removida(s) de ${blobs.length} total.`);
    res.status(200).json({
      removidas: paraApagar.length,
      totalAntes: blobs.length,
      diasParaManter: DIAS_PARA_MANTER,
    });
  } catch (erro) {
    console.error('[api/limpar-evidencias-antigas] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
