// services/uploadService.js

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Diretório base para salvar todos os uploads.
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'imagens');

// Função para garantir que os diretórios de upload existam.
const ensureDirectoriesExist = () => {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);
};

// Garante que as pastas existam quando o servidor iniciar.
ensureDirectoriesExist();

const uploadService = {
  /**
   * Processa um buffer de imagem, a converte para AVIF, e a salva localmente.
   * @param {object} file - O objeto 'file' do Multer (contém o buffer).
   * @returns {object} - Informações sobre o arquivo salvo, incluindo a URL acessível.
   */
  async processarESalvarImagem(file) {
    try {
      const uniqueFileName = `${uuidv4()}.avif`;
      const outputPath = path.join(IMAGES_DIR, uniqueFileName);

      // Usa o Sharp para processar a imagem do buffer em memória
      await sharp(file.buffer)
        .resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true })
        .toFormat('avif', { quality: 75 }) // Converte para AVIF com boa qualidade
        .toFile(outputPath);

      // Obtém o tamanho do arquivo salvo
      const stats = fs.statSync(outputPath);

      // Monta a URL pública para o arquivo.
      // O '/uploads/imagens/' corresponde à rota estática que definiremos no server.js
      const relativePath = `/uploads/imagens/${uniqueFileName}`;
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3045}`;
      const fullUrl = new URL(relativePath, baseUrl).href;

      // Retorna um objeto com as informações necessárias para salvar no banco de dados.
      return {
        nomeOriginal: file.originalname,
        nomeArquivo: uniqueFileName,
        url: fullUrl, // A URL completa que o frontend pode usar diretamente.
        tamanho: stats.size,
        tipo: 'image/avif',
        metadados: {}, // Você pode adicionar dimensões aqui se precisar
      };

    } catch (error) {
      console.error("Erro ao processar e salvar imagem:", error);
      throw new Error("Falha ao processar a imagem.");
    }
  },

  /**
   * Remove um arquivo do sistema de arquivos local.
   * @param {string} fileUrl - A URL completa do arquivo a ser removido.
   */
  async removerArquivo(fileUrl) {
    try {
        if (!fileUrl) return;

        const urlObj = new URL(fileUrl);
        // O pathname será algo como '/uploads/imagens/arquivo.avif'
        const relativePath = urlObj.pathname;
        
        // Constrói o caminho absoluto para o arquivo no servidor
        const localPath = path.join(__dirname, '..', relativePath);

        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            console.log(`Arquivo local removido: ${localPath}`);
        } else {
            console.warn(`Arquivo local não encontrado para remoção: ${localPath}`);
        }
    } catch (error) {
        console.error(`Erro ao remover arquivo local ${fileUrl}:`, error);
        // Não lançamos um erro para não quebrar a operação principal (ex: deletar produto)
    }
  }
};

module.exports = uploadService;