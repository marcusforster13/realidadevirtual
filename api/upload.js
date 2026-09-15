import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const { id, hash, timestamp, imageBase64 } = req.body;

    if (!id || !hash || !imageBase64) {
      res.status(400).json({ error: 'Faltam campos obrigatórios (id, hash, imageBase64)' });
      return;
    }

    // O dataURL vem como "data:image/png;base64,XXXXX" - separa só a parte
    // do base64 de verdade antes de converter pra bytes.
    const base64Data = imageBase64.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // Nome do arquivo já carrega o id e o hash - assim a página de galeria
    // consegue mostrar essa informação sem precisar de banco de dados
    // separado, só lendo a lista de arquivos do Blob Storage.
    const pathname = `evidencias/${id}__${hash}.png`;

    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType: 'image/png',
    });

    res.status(200).json({ url: blob.url, pathname: blob.pathname });
  } catch (erro) {
    console.error('[api/upload] erro:', erro);
    res.status(500).json({ error: erro.message });
  }
}
