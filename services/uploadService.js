// src/services/uploadService.js

const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
require("dotenv").config();

// Define os diretórios de upload.
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads'); // __dirname se refere ao diretório atual (services)
const IMAGES_DIR = path.join(UPLOADS_DIR, 'imagens');

// Garante que os diretórios existam na inicialização.
[UPLOADS_DIR, IMAGES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const uploadService = {
  /**
   * Processa um buffer de imagem, otimiza e salva localmente.
   * @param {Buffer} buffer - O buffer do arquivo de imagem.
   * @returns {Promise<object>} - Informações sobre o arquivo salvo.
   */
  async processarESalvarImagem(file) {
    try {
      const fileName = `${uuidv4()}.avif`;
      const filePath = path.join(IMAGES_DIR, fileName);

      // Otimiza a imagem usando sharp
      await sharp(file.buffer)
        .resize({ width: 1280, withoutEnlargement: true }) // Redimensiona se for maior que 1280px
        .avif({ quality: 75 })
        .toFile(filePath);

      const stats = fs.statSync(filePath);

      // Constrói a URL pública do arquivo com base na URL da própria API
      const publicUrl = `${process.env.BASE_URL || process.env.URL}/uploads/imagens/${fileName}`;

      return {
        nomeOriginal: file.originalname,
        nomeArquivo: fileName,
        caminho: filePath, // Caminho no sistema de arquivos
        url: publicUrl, // URL pública completa
        tamanho: stats.size,
        tipo: 'image/avif',
      };
    } catch (error) {
      console.error("Erro ao processar e salvar imagem:", error);
      throw new Error("Falha ao processar a imagem.");
    }
  },

  /**
   * Processa múltiplos arquivos de imagem.
   */
  async processarMultiplasImagens(files) {
    const processedImages = [];
    for (const file of files) {
      try {
        const imageInfo = await this.processarESalvarImagem(file);
        processedImages.push(imageInfo);
      } catch (error) {
        console.error(`Erro ao processar ${file.originalname}:`, error);
      }
    }
    return processedImages;
  },

  /**
   * Remove um arquivo do sistema de arquivos local.
   * @param {string} publicUrl - A URL pública do arquivo a ser removido.
   */
  async removerArquivo(publicUrl) {
    try {
      if (!publicUrl) return false;
      
      // Extrai o nome do arquivo da URL
      const fileName = path.basename(publicUrl);
      // Tenta encontrar o arquivo em todos os subdiretórios conhecidos de 'uploads'
      const possiblePaths = [
        path.join(IMAGES_DIR, fileName),
        // Adicione outros diretórios se necessário (ex: path.join(UPLOADS_DIR, 'videos', fileName))
      ];

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Arquivo removido com sucesso: ${filePath}`);
          return true;
        }
      }
      
      console.warn(`Arquivo não encontrado para remoção no sistema de arquivos: ${fileName}`);
      return false;

    } catch (error) {
      console.error("Erro ao remover arquivo:", error);
      return false;
    }
  },
};

module.exports = uploadService;