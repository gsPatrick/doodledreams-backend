// src/services/produtoService.js

const { Produto, ArquivoProduto, Avaliacao, Usuario, ItemPedido, Pedido, Categoria, VariacaoProduto } = require("../models")
const { Op, fn, col, literal } = require("sequelize")

const produtoService = {
  async criarProduto(dados) {
    try {
      // O Sequelize lida automaticamente com a conversão de objetos/arrays para JSON
      // se o tipo de dado no modelo for DataTypes.JSON.
      // Apenas garantimos que os dados cheguem aqui no formato correto.
      const produto = await Produto.create(dados);
      return produto;
    } catch (error) {
      console.error("Erro ao criar produto no serviço:", error);
      throw error;
    }
  },

  // --- FUNÇÃO atualizarProduto ATUALIZADA ---
  async atualizarProduto(id, dados) {
    try {
      const produto = await Produto.findByPk(id);
      if (!produto) {
        throw new Error("Produto não encontrado");
      }

      // O Sequelize também lida com a atualização de campos JSON.
      // O operador spread (...) garante que apenas os campos enviados sejam atualizados.
      await produto.update(dados);

      return produto;
    } catch (error) {
      console.error("Erro ao atualizar produto no serviço:", error);
      throw error;
    }
  },

  async removerProduto(id) {
    try {
      const produto = await Produto.findByPk(id)
      if (!produto) {
        throw new Error("Produto não encontrado")
      }

      // NOVO: Lógica para remover arquivos associados (chamar o uploadService)
      const arquivosAssociados = await ArquivoProduto.findAll({ where: { produtoId: id } });
      for (const arquivo of arquivosAssociados) {
          try {
              // Chama o uploadService para remover do File Server
              await require('./uploadService').removerArquivo(arquivo.url);
              await arquivo.destroy(); // Remove do banco de dados
          } catch (err) {
              console.warn(`Falha ao remover arquivo ${arquivo.url} do File Server ou DB: ${err.message}`);
              // Continua a remoção do produto mesmo que o arquivo falhe
          }
      }

      await produto.destroy()
      return { message: "Produto removido com sucesso" }
    } catch (error) {
      throw error
    }
  },

  async listarProdutos(filtros = {}) {
    try {
      const { categorias, busca, page = 1, limit = 10, ordenarPor } = filtros

      const where = { ativo: true }

      if (categorias) {
        const listaCategorias = categorias.split(',').map(c => c.trim());
        if (listaCategorias.length > 0) {
          where.categoriaId = { [Op.in]: listaCategorias };
        }
      }

      if (busca) {
        const palavras = busca.trim().split(/\s+/).filter(palavra => palavra.length > 0);
        
        if (palavras.length > 0) {
          where[Op.and] = palavras.map(palavra => ({
            [Op.or]: [
              {
                nome: {
                  [Op.like]: `%${palavra}%`
                }
              },
              {
                descricao: {
                  [Op.like]: `%${palavra}%`
                }
              }
            ]
          }));
        }
      }

      const totalCount = await Produto.count({ where });
      
      const offset = (page - 1) * limit

      let order = []
      const includeOptions = [
        { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
        { model: Avaliacao, include: [{ model: Usuario, attributes: ["nome"] }], required: false },
        { model: VariacaoProduto, as: 'variacoes', required: false }
      ];

      const findOptions = {
        where,
        include: includeOptions,
        order,
        subQuery: false,
      };
      
      if (totalCount > parseInt(limit)) {
        findOptions.limit = parseInt(limit);
        findOptions.offset = offset;
      }

      switch (ordenarPor) {
        case "nome_asc": order.push(["nome", "ASC"]); break;
        case "nome_desc": order.push(["nome", "DESC"]); break;
        case "lancamentos":
        default:
          order.push(["createdAt", "DESC"]);
      }

      const produtos = await Produto.findAll(findOptions);
      // REMOVIDO: const baseUrl = process.env.BASE_URL || 'http://localhost:3035';

      const produtosFormatados = produtos.map(produto => {
        const p = produto.toJSON();

        // URLs já virão completas do ArquivoProduto.url
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1) || a.ordem - b.ordem)
          .map(arq => arq.url); // Use arq.url diretamente

        p.itensDownload = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url // Use arq.url diretamente
          }));
          
        p.videos = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'video')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url, // Use arq.url diretamente
            metadados: arq.metadados
          }));
          
        // Não é mais necessário modificar p.ArquivoProdutos individualmente se url já é absoluta
        // p.ArquivoProdutos = (p.ArquivoProdutos || []).map(arq => {
        //   return { ...arq, url: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href };
        // });

        return p;
      });

      return {
        produtos: produtosFormatados,
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        currentPage: parseInt(page),
      }
    } catch (error) {
      console.error("Erro ao listar produtos:", error);
      throw error
    }
  },

  async buscarProdutoPorId(idOuSlug) {
    try {
      const isNumeric = !isNaN(parseFloat(idOuSlug)) && isFinite(idOuSlug);
      const whereClause = isNumeric 
        ? { id: idOuSlug, ativo: true } 
        : { slug: idOuSlug, ativo: true };

      const produto = await Produto.findOne({
        where: whereClause,
        include: [
          { model: ArquivoProduto, as: "ArquivoProdutos", required: false },
          { model: Avaliacao, include: [{ model: Usuario, attributes: ["nome"] }] },
          { model: Categoria, as: 'categoria', attributes: ['id', 'nome'] },
          { model: VariacaoProduto, as: 'variacoes', required: false }
        ],
      });

      if (!produto) {
        throw new Error("Produto não encontrado");
      }

      const produtoJSON = produto.toJSON();
      // REMOVIDO: const baseUrl = process.env.BASE_URL || 'http://localhost:3035';

      // URLs já virão completas do ArquivoProduto.url
      produtoJSON.imagens = (produtoJSON.ArquivoProdutos || [])
        .filter(arq => arq.tipo === 'imagem')
        .sort((a, b) => (a.principal === b.principal) ? 0 : a.principal ? -1 : 1)
        .map(arq => arq.url); // Use arq.url diretamente

      produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || [])
        .filter(arq => arq.tipo === 'arquivo')
        .map(arq => ({
          id: arq.id,
          nome: arq.nome,
          url: arq.url // Use arq.url diretamente
        }));
        
      produtoJSON.videos = (produtoJSON.ArquivoProdutos || [])
        .filter(arq => arq.tipo === 'video')
        .map(arq => ({
          id: arq.id,
          nome: arq.nome,
          url: arq.url, // Use arq.url diretamente
          metadados: arq.metadados
        }));

      // Não é mais necessário modificar produtoJSON.ArquivoProdutos individualmente
      // produtoJSON.ArquivoProdutos = (produtoJSON.ArquivoProdutos || []).map(arq => {
      //   return { ...arq, url: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href };
      // });

      return produtoJSON;
    } catch (error) {
      throw error;
    }
  },

  async adicionarImagemProduto(produtoId, imagemInfo) { // Recebe um objeto imagemInfo formatado do uploadService
    try {
      const produto = await Produto.findByPk(produtoId)
      if (!produto) {
        throw new Error("Produto não encontrado")
      }

      const arquivoProduto = await ArquivoProduto.create({
        produtoId,
        nome: imagemInfo.nomeOriginal,
        url: imagemInfo.url, // URL COMPLETA
        mimeType: imagemInfo.tipo,
        tamanho: imagemInfo.tamanho,
        tipo: "imagem",
        metadados: imagemInfo.metadados // Salva as variantes/metadados retornados do File Server
      })

      return arquivoProduto
    } catch (error) {
      throw error
    }
  },

  async adicionarArquivoProduto(produtoId, arquivoInfo) { // Recebe um objeto arquivoInfo formatado do uploadService
    try {
      const produto = await Produto.findByPk(produtoId)
      if (!produto) {
        throw new Error("Produto não encontrado")
      }

      const arquivoProduto = await ArquivoProduto.create({
        produtoId,
        nome: arquivoInfo.nomeOriginal,
        url: arquivoInfo.url, // URL COMPLETA
        mimeType: arquivoInfo.tipo,
        tamanho: arquivoInfo.tamanho,
        tipo: 'arquivo',
        metadados: {} // Ou qualquer metadado relevante para arquivos
      })

      return arquivoProduto
    } catch (error) {
      throw error
    }
  },

  async removerArquivoProduto(produtoId, arquivoId) {
    try {
      const arquivo = await ArquivoProduto.findOne({
        where: { id: arquivoId, produtoId: produtoId },
      })

      if (!arquivo) {
        throw new Error("Arquivo não encontrado")
      }

      // NOVO: Chamar o uploadService para remover do File Server
      const uploadService = require('./uploadService'); // Importa aqui para evitar circular dependency
      await uploadService.removerArquivo(arquivo.url); // Passa a URL completa

      // Excluir do banco de dados
      await arquivo.destroy()

      return { message: "Arquivo removido com sucesso" }
    } catch (error) {
      throw error
    }
  },

  async listarArquivosPorProduto(produtoId) {
    try {
      const arquivos = await ArquivoProduto.findAll({
        where: { produtoId },
      })
      // As URLs já virão completas do banco de dados
      return arquivos
    } catch (error) {
      throw error
    }
  },

  async listarLancamentos({ limit = 10 } = {}) {
    try {
      const produtos = await Produto.findAll({
        where: { ativo: true },
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false }
        ],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit, 10),
      });

      // REMOVIDO: const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      
      const produtosFormatados = produtos.map(produto => {
        const produtoJSON = produto.toJSON();
        
        // URLs já virão completas do ArquivoProduto.url
        produtoJSON.imagens = (produtoJSON.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal === b.principal) ? 0 : a.principal ? -1 : 1)
          .map(arq => arq.url);
          
        produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url // Use arq.url diretamente
          }));
          
        produtoJSON.videos = (produtoJSON.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'video')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url, // Use arq.url diretamente
            metadados: arq.metadados
          }));
          
        // Não é mais necessário modificar produtoJSON.ArquivoProdutos individualmente
        // produtoJSON.ArquivoProdutos = (produtoJSON.ArquivoProdutos || []).map(arq => {
        //   return { ...arq, url: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href };
        // });
        
        return produtoJSON;
      });
      
      return produtosFormatados;
    } catch (error) {
      throw error;
    }
  },

  async listarMaisVendidos({ limit = 10 } = {}) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          status: { [Op.in]: ['pago', 'processando', 'enviado', 'entregue'] }
        },
        attributes: ['itens']
      });

      if (pedidos.length === 0) {
        return [];
      }

      const contagemDeVendas = pedidos.reduce((acc, pedido) => {
        if (pedido.itens && Array.isArray(pedido.itens)) {
          pedido.itens.forEach(item => {
            // Se o item.id no pedido é o ID do produto, mantenha.
            // Se for o ID da variação, você precisa mapear para o produtoId.
            // Assumindo que item.produtoId é o que você quer contar aqui.
            if (item.produtoId && item.quantidade) { // Usar item.produtoId
              acc[item.produtoId] = (acc[item.produtoId] || 0) + item.quantidade;
            }
          });
        }
        return acc;
      }, {});

      if (Object.keys(contagemDeVendas).length === 0) {
        return [];
      }

      const maisVendidosIds = Object.entries(contagemDeVendas)
        .sort(([, a], [, b]) => b - a)
        .slice(0, parseInt(limit, 10))
        .map(([id]) => id);

      if (maisVendidosIds.length === 0) {
        return [];
      }

      const produtos = await Produto.findAll({
        where: {
          id: { [Op.in]: maisVendidosIds },
          ativo: true
        },
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false }
        ]
      });

      const produtosNaoFormatados = maisVendidosIds.map(id => produtos.find(p => p.id == id)).filter(p => p);
      
      // REMOVIDO: const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      
      const produtosFormatados = produtosNaoFormatados.map(produto => {
        const produtoJSON = produto.toJSON();
        
        // URLs já virão completas do ArquivoProduto.url
        produtoJSON.imagens = (produtoJSON.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal === b.principal) ? 0 : a.principal ? -1 : 1)
          .map(arq => arq.url);
          
        produtoJSON.itensDownload = (produtoJSON.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url // Use arq.url diretamente
          }));
          
        produtoJSON.videos = (produtoJSON.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'video')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url, // Use arq.url diretamente
            metadados: arq.metadados
          }));
          
        // Não é mais necessário modificar produtoJSON.ArquivoProdutos individualmente
        // produtoJSON.ArquivoProdutos = (produtoJSON.ArquivoProdutos || []).map(arq => {
        //   return { ...arq, url: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href };
        // });
        
        return produtoJSON;
      });

      return produtosFormatados;
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
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false },
        ],
      });

      // REMOVIDO: const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
        // URLs já virão completas do ArquivoProduto.url
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1))
          .map(arq => arq.url);
        return p;
      });

      return produtosFormatados;
    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },
}

module.exports = produtoService;