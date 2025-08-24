// src/controllers/uploadController.js

const uploadService = require("../services/uploadService")
const { Categoria } = require("../models") // Adicionar import da Categoria
const { ArquivoProduto } = require("../models")
// deleteImageVariants não é mais usado diretamente aqui
// const { deleteImageVariants } = require("../utils/imageProcessor") 
const produtoService = require("../services/produtoService")
const fs = require("fs") // Pode não ser mais necessário para operações diretas de arquivo

const uploadController = {
  /**
   * Upload de imagem de produto (Múltiplas imagens)
   * Este endpoint agora espera um array de arquivos e os envia individualmente para o File Server.
   */


  /**
   * Upload de imagem de categoria
   */
  async uploadCategoriaImagem(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ erro: "Nenhum arquivo enviado." });
      }

      const { categoriaId } = req.params;
      const file = req.file;

      const categoria = await Categoria.findByPk(categoriaId);
      if (!categoria) {
        return res.status(404).json({ erro: "Categoria não encontrada." });
      }

      // Salva a imagem no File Server (tipo 'categorias')
      const imagemInfo = await uploadService.processarESalvarImagem(file);

      // Atualiza a categoria com a URL da nova imagem
      categoria.imagemUrl = imagemInfo.url; // Adicionamos a URL completa
      await categoria.save();

      res.status(200).json(categoria);
    } catch (error) {
      console.error("Erro ao fazer upload de imagem da categoria:", error);
      next(error);
    }
  },

  async uploadProdutoImagens(req, res, next) {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ erro: "Nenhuma imagem enviada para upload." });
      }

      const { produtoId } = req.params;
      const files = req.files; // req.files é usado por multer.array

      const produto = await produtoService.buscarProdutoPorId(produtoId);
      if (!produto) {
        return res.status(404).json({ erro: "Produto não encontrado." });
      }

      // Verifica se já existem imagens para este produto para definir a primeira como principal
      const imagensExistentes = await ArquivoProduto.findAll({
        where: { produtoId, tipo: "imagem" },
        limit: 1 // Basta saber se existe pelo menos uma
      });

      let definirComoPrincipal = imagensExistentes.length === 0;
      const imagensCriadas = [];

      for (const file of files) {
        const imagemInfo = await uploadService.processarESalvarImagem(file); // Envia para o File Server
        
        const imagem = await ArquivoProduto.create({
          produtoId,
          tipo: "imagem",
          nome: imagemInfo.nomeOriginal,
          url: imagemInfo.url, // URL COMPLETA do File Server
          mimeType: imagemInfo.tipo,
          tamanho: imagemInfo.tamanho,
          metadados: imagemInfo.metadados, // Metadados das variantes
          principal: definirComoPrincipal,
        });

        imagensCriadas.push(imagem);
        if (definirComoPrincipal) {
          definirComoPrincipal = false;
        }
      }

      res.status(201).json(imagensCriadas);
    } catch (error) {
      console.error("Erro ao fazer upload de múltiplas imagens do produto:", error);
      next(error);
    }
  },

  /**
   * Upload de arquivo de produto digital
   */
  async uploadProdutoArquivo(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ erro: "Nenhum arquivo enviado." });
      }

      const { produtoId } = req.params;
      const file = req.file;

      const produto = await produtoService.buscarProdutoPorId(produtoId);
      if (!produto) {
        return res.status(404).json({ erro: "Produto não encontrado." });
      }

      // Salva arquivo no File Server (tipo 'produtos')
      const arquivoInfo = await uploadService.salvarArquivo(file, "produtos"); // tipo "produtos" para a pasta do File Server

      // Adicionar arquivo ao produto no banco de dados
      const arquivo = await ArquivoProduto.create({
        produtoId,
        nome: arquivoInfo.nomeOriginal,
        url: arquivoInfo.url, // URL COMPLETA
        mimeType: arquivoInfo.tipo,
        tamanho: arquivoInfo.tamanho,
        tipo: 'arquivo',
      });

      res.status(201).json(arquivo);
    } catch (error) {
      console.error("Erro ao fazer upload de arquivo digital do produto:", error);
      next(error);
    }
  },

  /**
   * Upload de vídeo de produto
   */
  async uploadProdutoVideo(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ erro: "Nenhum vídeo enviado." });
      }

      const { produtoId } = req.params;
      const file = req.file;

      const produto = await produtoService.buscarProdutoPorId(produtoId);
      if (!produto) {
        return res.status(404).json({ erro: "Produto não encontrado." });
      }
      
      // Salva vídeo no File Server (tipo 'videos')
      const videoInfo = await uploadService.salvarArquivo(file, "videos"); // tipo "videos" para a pasta do File Server

      const video = await ArquivoProduto.create({
        produtoId,
        tipo: 'video',
        nome: videoInfo.nomeOriginal,
        url: videoInfo.url, // URL COMPLETA
        mimeType: videoInfo.tipo,
        tamanho: videoInfo.tamanho,
        metadados: videoInfo.metadados || {} // Se houver metadados adicionais do file server
      });

      res.status(201).json(video);
    } catch (error) {
      console.error("Erro ao fazer upload de vídeo do produto:", error);
      next(error);
    }
  },

  /**
   * Define uma imagem como a principal de um produto
   */
  async definirImagemPrincipal(req, res, next) {
    try {
      const { produtoId, arquivoId } = req.params;

      // Primeiro, remove a flag 'principal' de outras imagens do mesmo produto
      await ArquivoProduto.update(
        { principal: false },
        { where: { produtoId, tipo: "imagem" } }
      );

      // Depois, define a imagem escolhida como principal
      const [updatedRows] = await ArquivoProduto.update(
        { principal: true },
        { where: { id: arquivoId, produtoId, tipo: "imagem" } }
      );

      if (updatedRows === 0) {
        return res.status(404).json({ erro: "Imagem não encontrada ou não pertence a este produto." });
      }

      res.json({ message: "Imagem principal definida com sucesso." });
    } catch (error) {
      console.error("Erro ao definir imagem principal:", error);
      next(error);
    }
  },

  /**
   * Exclui um arquivo (imagem ou de download) de um produto
   */
  async excluirArquivo(req, res, next) {
    try {
      const { arquivoId } = req.params;
      const arquivo = await ArquivoProduto.findByPk(arquivoId);

      if (!arquivo) {
        return res.status(404).json({ erro: "Arquivo não encontrado." });
      }

      // NOVO: Chamar o uploadService para remover do File Server
      await uploadService.removerArquivo(arquivo.url); 

      // Excluir do banco de dados
      await arquivo.destroy();

      res.json({ message: "Arquivo excluído com sucesso." });
    } catch (error) {
      console.error("Erro ao excluir arquivo:", error);
      next(error);
    }
  },

  /**
   * Atualiza a ordem das imagens de um produto
   */
  async atualizarOrdemImagens(req, res, next) {
    try {
      const { produtoId } = req.params;
      const { ordem } = req.body;

      if (!Array.isArray(ordem)) {
        return res.status(400).json({ erro: "O formato da ordem deve ser um array de IDs." });
      }

      for (let i = 0; i < ordem.length; i++) {
        await ArquivoProduto.update(
          { ordem: i },
          { where: { id: ordem[i], produtoId, tipo: "imagem" } }
        );
      }

      const imagens = await ArquivoProduto.findAll({
        where: { produtoId, tipo: "imagem" },
        order: [["ordem", "ASC"]]
      });

      res.json(imagens);
    } catch (error) {
      console.error("Erro ao atualizar ordem das imagens:", error);
      next(error);
    }
  },

  // As funções de otimizarImagem, obterInfoImagem e listarArquivos do uploadService
  // não serão mais usadas diretamente por um controlador, ou precisarão ser adaptadas
  // para chamar a API do File Server, se ele oferecer essa funcionalidade.
  // Elas foram removidas do `uploadService` ou marcadas como `warn`.
};

module.exports = uploadController;