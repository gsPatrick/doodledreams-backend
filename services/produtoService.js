// /services/produtoService.js

const { Produto, ArquivoProduto, Avaliacao, Usuario, Pedido, Categoria } = require("../models");
const { Op } = require("sequelize");

const produtoService = {
  async criarProduto(dados) {
    try {
      const produto = await Produto.create(dados);
      return produto;
    } catch (error) {
      console.error("Erro ao criar produto no serviço:", error);
      throw error;
    }
  },

  async atualizarProduto(id, dados) {
    try {
      const produto = await Produto.findByPk(id);
      if (!produto) {
        throw new Error("Produto não encontrado");
      }
      await produto.update(dados);
      return produto;
    } catch (error) {
      console.error("Erro ao atualizar produto no serviço:", error);
      throw error;
    }
  },

  async removerProduto(id) {
    try {
      const produto = await Produto.findByPk(id);
      if (!produto) {
        throw new Error("Produto não encontrado");
      }

      // Lógica para remover arquivos associados (chamar o uploadService)
      const arquivosAssociados = await ArquivoProduto.findAll({ where: { produtoId: id } });
      for (const arquivo of arquivosAssociados) {
        try {
          // Chama o uploadService para remover do sistema de arquivos
          await require('./uploadService').removerArquivo(arquivo.url);
          await arquivo.destroy(); // Remove do banco de dados
        } catch (err) {
          console.warn(`Falha ao remover arquivo ${arquivo.url}: ${err.message}`);
        }
      }

      await produto.destroy();
      return { message: "Produto removido com sucesso" };
    } catch (error) {
      throw error;
    }
  },

  async listarProdutos(filtros = {}) {
    try {
      const { categorias, busca, page = 1, limit = 10, ordenarPor } = filtros;
      const where = { ativo: true };

      if (categorias) {
        const listaCategorias = categorias.split(',').map(c => c.trim());
        if (listaCategorias.length > 0) {
          where.categoriaId = { [Op.in]: listaCategorias };
        }
      }

      if (busca) {
        where[Op.or] = [
          { nome: { [Op.like]: `%${busca}%` } },
          { descricao: { [Op.like]: `%${busca}%` } }
        ];
      }

      const offset = (page - 1) * limit;
      let order = [];
      switch (ordenarPor) {
        case "nome_asc": order.push(["nome", "ASC"]); break;
        case "nome_desc": order.push(["nome", "DESC"]); break;
        case "preco_asc": order.push(["preco", "ASC"]); break;
        case "preco_desc": order.push(["preco", "DESC"]); break;
        case "lancamentos":
        default:
          order.push(["createdAt", "DESC"]);
      }

      const { count, rows } = await Produto.findAndCountAll({
        where,
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: Avaliacao, include: [{ model: Usuario, attributes: ["nome"] }], required: false },
        ],
        order,
        limit: parseInt(limit),
        offset,
        distinct: true, // Importante para contagem correta com includes
      });

      const produtosFormatados = rows.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) || a.ordem - b.ordem)
          .map(arq => arq.url);
        
        // Remove ArquivoProdutos do objeto final para não poluir a resposta
        delete p.ArquivoProdutos;
        return p;
      });

      return {
        produtos: produtosFormatados,
        total: count,
        totalPages: Math.ceil(count / parseInt(limit)),
        currentPage: parseInt(page),
      };
    } catch (error) {
      console.error("Erro ao listar produtos:", error);
      throw error;
    }
  },

  async buscarProdutoPorId(idOuSlug) {
    try {
      const termoBusca = String(idOuSlug || '').trim();
      if (!termoBusca) {
        throw new Error("ID ou Slug do produto não fornecido.");
      }
      const isNumeric = !isNaN(parseFloat(termoBusca)) && isFinite(termoBusca);
      const whereClause = isNumeric ? { id: parseInt(termoBusca, 10), ativo: true } : { slug: termoBusca, ativo: true };

      console.log(`[produtoService] Buscando produto com a cláusula:`, whereClause);

      const produto = await Produto.findOne({
        where: whereClause,
        include: [
          { model: ArquivoProduto, as: "ArquivoProdutos", required: false },
          { model: Avaliacao, include: [{ model: Usuario, attributes: ["nome"] }] },
          { model: Categoria, as: 'categoria', attributes: ['id', 'nome'] },
        ],
      });

      if (!produto) {
        console.warn(`[produtoService] Produto não encontrado para a cláusula:`, whereClause);
        throw new Error("Produto não encontrado");
      }

      const produtoJSON = produto.toJSON();
      produtoJSON.imagens = (produtoJSON.ArquivoProdutos || [])
        .filter(arq => arq.tipo === 'imagem')
        .sort((a, b) => (a.principal ? -1 : 1) || a.ordem - b.ordem)
        .map(arq => arq.url);

      produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || [])
        .filter(arq => arq.tipo === 'arquivo')
        .map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url }));
        
      produtoJSON.videos = (produtoJSON.ArquivoProdutos || [])
        .filter(arq => arq.tipo === 'video')
        .map(arq => ({ id: arq.id, nome: arq.nome, url: arq.url, metadados: arq.metadados }));

      delete produtoJSON.ArquivoProdutos;
      return produtoJSON;
    } catch (error) {
      throw error;
    }
  },

  async listarLancamentos({ limit = 10 } = {}) {
    try {
      const produtos = await Produto.findAll({
        where: { ativo: true },
        include: [{ model: ArquivoProduto, as: 'ArquivoProdutos', required: false }],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit, 10),
      });
      
      return produtos.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) || a.ordem - b.ordem)
          .map(arq => arq.url);
        delete p.ArquivoProdutos;
        return p;
      });
    } catch (error) {
      throw error;
    }
  },

  async listarMaisVendidos({ limit = 10 } = {}) {
    try {
      const pedidos = await Pedido.findAll({
        where: { status: { [Op.in]: ['pago', 'processando', 'enviado', 'entregue'] } },
        attributes: ['itens']
      });

      if (!pedidos.length) return [];

      const contagemDeVendas = pedidos.reduce((acc, pedido) => {
        if (pedido.itens && Array.isArray(pedido.itens)) {
          pedido.itens.forEach(item => {
            if (item.produtoId && item.quantidade) {
              acc[item.produtoId] = (acc[item.produtoId] || 0) + item.quantidade;
            }
          });
        }
        return acc;
      }, {});

      if (Object.keys(contagemDeVendas).length === 0) return [];

      const maisVendidosIds = Object.entries(contagemDeVendas)
        .sort(([, a], [, b]) => b - a)
        .slice(0, parseInt(limit, 10))
        .map(([id]) => id);

      if (!maisVendidosIds.length) return [];

      const produtos = await Produto.findAll({
        where: { id: { [Op.in]: maisVendidosIds }, ativo: true },
        include: [{ model: ArquivoProduto, as: 'ArquivoProdutos', required: false }]
      });

      const produtosOrdenados = maisVendidosIds.map(id => produtos.find(p => p.id == id)).filter(Boolean);
      
      return produtosOrdenados.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) || a.ordem - b.ordem)
          .map(arq => arq.url);
        delete p.ArquivoProdutos;
        return p;
      });
    } catch (error) {
      console.error("Erro detalhado ao listar mais vendidos:", error);
      throw error;
    }
  },

  async buscarProdutosRelacionados(idOuSlug, limite = 4) {
    try {
      const isNumeric = !isNaN(parseFloat(idOuSlug)) && isFinite(idOuSlug);
      const whereClause = isNumeric ? { id: idOuSlug } : { slug: idOuSlug };

      const produtoAtual = await Produto.findOne({ where: whereClause });
      if (!produtoAtual || !produtoAtual.categoriaId) {
        return [];
      }

      const relacionados = await Produto.findAll({
        where: {
          categoriaId: produtoAtual.categoriaId,
          id: { [Op.ne]: produtoAtual.id },
          ativo: true,
        },
        limit: parseInt(limite),
        include: [{ model: ArquivoProduto, as: 'ArquivoProdutos', required: false }],
      });

      return relacionados.map(produto => {
        const p = produto.toJSON();
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) || a.ordem - b.ordem)
          .map(arq => arq.url);
        delete p.ArquivoProdutos;
        return p;
      });
    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },
  
  // As funções de manipulação de arquivos (adicionar/remover) permanecem as mesmas
  // pois elas já operam no modelo ArquivoProduto, que não foi alterado.
  async adicionarImagemProduto(produtoId, imagemInfo) {
    try {
      const produto = await Produto.findByPk(produtoId);
      if (!produto) throw new Error("Produto não encontrado");
      const arquivoProduto = await ArquivoProduto.create({
        produtoId,
        nome: imagemInfo.nomeOriginal,
        url: imagemInfo.url,
        mimeType: imagemInfo.tipo,
        tamanho: imagemInfo.tamanho,
        tipo: "imagem",
        metadados: imagemInfo.metadados
      });
      return arquivoProduto;
    } catch (error) {
      throw error;
    }
  },

  async adicionarArquivoProduto(produtoId, arquivoInfo) {
    try {
      const produto = await Produto.findByPk(produtoId);
      if (!produto) throw new Error("Produto não encontrado");
      const arquivoProduto = await ArquivoProduto.create({
        produtoId,
        nome: arquivoInfo.nomeOriginal,
        url: arquivoInfo.url,
        mimeType: arquivoInfo.tipo,
        tamanho: arquivoInfo.tamanho,
        tipo: 'arquivo',
      });
      return arquivoProduto;
    } catch (error) {
      throw error;
    }
  },

  async removerArquivoProduto(produtoId, arquivoId) {
    try {
      const arquivo = await ArquivoProduto.findOne({ where: { id: arquivoId, produtoId: produtoId } });
      if (!arquivo) throw new Error("Arquivo não encontrado");
      await require('./uploadService').removerArquivo(arquivo.url);
      await arquivo.destroy();
      return { message: "Arquivo removido com sucesso" };
    } catch (error) {
      throw error;
    }
  },

  async listarArquivosPorProduto(produtoId) {
    try {
      return await ArquivoProduto.findAll({ where: { produtoId } });
    } catch (error) {
      throw error;
    }
  },
};

module.exports = produtoService;