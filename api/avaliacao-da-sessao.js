import { head } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const { sessaoId } = req.query;
    if (!sessaoId) {
      res.status(400).json({ error: 'Faltou o parâmetro sessaoId' });
      return;
    }

    const pathname = `sessoes/${sessaoId}/avaliacao.json`;

    try {
      const info = await head(pathname);
      const resposta = await fetch(info.url);
      const dados = await resposta.json();
      res.status(200).json(dados);
    } catch {
      res.status(200).json(null);
    }
  } catch (erro) {
    console.error('[api/avaliacao-da-sessao] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
