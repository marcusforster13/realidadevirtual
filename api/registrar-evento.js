import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const { sessaoId, tipo, descricao, posicao, timestamp } = req.body;

    if (!sessaoId || !tipo) {
      res.status(400).json({ error: 'Faltam campos obrigatórios (sessaoId, tipo)' });
      return;
    }

    const agora = timestamp || new Date().toISOString();
    // Nome único por evento - cada evento é um arquivo próprio, imutável,
    // igual já fazemos com as evidências.
    const nomeArquivo = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    const pathname = `eventos/${sessaoId}/${nomeArquivo}`;

    const dados = { sessaoId, tipo, descricao, posicao: posicao || null, timestamp: agora };

    await put(pathname, JSON.stringify(dados), {
      access: 'public',
      contentType: 'application/json',
    });

    res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('[api/registrar-evento] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
