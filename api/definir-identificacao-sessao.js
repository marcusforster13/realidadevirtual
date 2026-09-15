import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const { sessaoId, operador, matricula, unidade, cenario } = req.body;
    if (!sessaoId) {
      res.status(400).json({ error: 'Faltou o campo sessaoId' });
      return;
    }

    const pathname = `sessoes/${sessaoId}/identificacao.json`;
    const dados = {
      sessaoId,
      operador: operador || '',
      matricula: matricula || '',
      unidade: unidade || '',
      cenario: cenario || '',
      horaInicio: new Date().toISOString(),
    };

    await put(pathname, JSON.stringify(dados), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('[api/definir-identificacao-sessao] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
