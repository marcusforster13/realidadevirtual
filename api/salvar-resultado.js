import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const dados = req.body;

    if (!dados || !dados.id) {
      res.status(400).json({ error: 'Dados inválidos (faltou o id)' });
      return;
    }

    const pathname = `resultados/${dados.id}.json`;

    await put(pathname, JSON.stringify(dados), {
      access: 'public',
      contentType: 'application/json',
    });

    res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('[api/salvar-resultado] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
