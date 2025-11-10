const { Pedido, Usuario, Produto, Pagamento, ArquivoProduto, Frete, VariacaoProduto } = require("../models")
const { enviarEmail, templateConfirmacaoPedido } = require("../utils/email")
const cupomService = require("./cupomService")
const notificacaoService = require("./notificacaoService")
const pagamentoService = require("./pagamentoService")
const { Op } = require('sequelize');

const pedidoService = {
  async criarPedido(usuarioId, itensPedido, enderecoEntrega, freteId, cupomCodigo = null) {
    try {
      let total = 0;
      let desconto = 0;
      let valorFrete = 0;
      let dadosFrete = null;
      let cupomAplicadoId = null; 

      // 1. VERIFICAR SE O PEDIDO É TOTALMENTE DIGITAL
      const verificacoesDigitais = await Promise.all(
        itensPedido.map(async (item) => {
          if (item.variacaoId) {
            const variacao = await VariacaoProduto.findOne({ where: { id: item.variacaoId, produtoId: item.produtoId }});
            if (!variacao || !variacao.ativo) return false;
            return variacao.digital;
          }
          return false; 
        })
      );
      const todosDigitais = verificacoesDigitais.every(isDigital => isDigital);

      // Se não for totalmente digital, um endereço de entrega é obrigatório
      if (!todosDigitais && !enderecoEntrega) {
        throw new Error("Endereço de entrega é obrigatório para produtos físicos.");
      }

      // 2. PROCESSAR ITENS, CALCULAR SUBTOTAL E VALIDAR ESTOQUE
      const itensProcessados = [];
      let quantidadeTotalItens = 0;
      for (const item of itensPedido) {
        // Busca o produto com os atributos necessários
        const produto = await Produto.findByPk(item.produtoId, {
          attributes: ['id', 'nome', 'subtitulo', 'ativo', 'peso', 'largura', 'altura', 'comprimento']
        });
        if (!produto || !produto.ativo) throw new Error(`Produto com ID ${item.produtoId} não encontrado ou inativo.`);

        let variacao = null;
        let precoBase;
        let eDigital = false;

        if (item.variacaoId) {
          variacao = await VariacaoProduto.findOne({ where: { id: item.variacaoId, produtoId: item.produtoId } });
          if (!variacao || !variacao.ativo) throw new Error(`Variação ${item.variacaoId} para o produto "${produto.nome}" não encontrada ou inativa.`);
          
          precoBase = variacao.preco;
          eDigital = variacao.digital;
          
          if (!eDigital && variacao.estoque < item.quantidade) {
            throw new Error(`Estoque insuficiente para a variação "${variacao.nome}" do produto "${produto.nome}".`);
          }
        } else {
          // Lógica para produto sem variação (se aplicável no seu sistema)
          // Se todos os produtos tiverem variações, essa lógica pode ser removida.
          precoBase = produto.preco; // Supondo que o modelo Produto tenha um preço base
          eDigital = false; // Supondo que produtos sem variação são sempre físicos
          if (produto.estoque < item.quantidade) { // Supondo que o modelo Produto tenha controle de estoque
            throw new Error(`Estoque insuficiente para o produto "${produto.nome}".`);
          }
        }
        
        total += parseFloat(precoBase) * item.quantidade;
        quantidadeTotalItens += item.quantidade;
        
        itensProcessados.push({
          produtoId: item.produtoId,
          variacaoId: item.variacaoId || null,
          nome: variacao ? `${produto.nome} - ${variacao.nome}` : produto.nome,
          subtitulo: produto.subtitulo,
          preco: parseFloat(precoBase),
          quantidade: item.quantidade,
          subtotal: parseFloat(precoBase) * item.quantidade,
          digital: eDigital,
          dimensoes: {
            peso: produto.peso,
            largura: produto.largura,
            altura: produto.altura,
            comprimento: produto.comprimento,
          }
        });
      }

      // 3. VALIDAR E APLICAR CUPOM DE DESCONTO
      if (cupomCodigo) {
        const cupom = await cupomService.validarCupom(cupomCodigo, total, quantidadeTotalItens, usuarioId);

        if (cupom.tipo === "percentual") {
          desconto = (total * cupom.valor) / 100;
        } else { // tipo === "fixo"
          desconto = cupom.valor;
        }

        total = Math.max(0, total - desconto); // Aplica o desconto ao subtotal
        cupomAplicadoId = cupom.id;
      }

      // 4. CALCULAR FRETE (SE NECESSÁRIO)
      if (!todosDigitais) {
        const enderecoOrigem = await configuracaoLojaService.obterEnderecoOrigem();
        const itensFisicos = itensPedido.filter((_, index) => !verificacoesDigitais[index]);
        const opcoesFrete = await freteService.calcularFrete(enderecoOrigem, enderecoEntrega, itensFisicos);
        
        const freteSelecionado = opcoesFrete.find(opt => opt.id === freteId);
        if (!freteSelecionado) throw new Error("Método de frete selecionado é inválido.");
        
        valorFrete = parseFloat(freteSelecionado.price);
        dadosFrete = { 
          servico: freteSelecionado.name, 
          valor: valorFrete, 
          prazoEntrega: freteSelecionado.delivery_time, 
          statusEntrega: "pendente" 
        };
      } else {
        valorFrete = 0;
      }
      
      const totalFinal = total + valorFrete;

      // 5. CRIAR O PEDIDO NO BANCO DE DADOS
      const pedido = await Pedido.create({
        usuarioId,
        itens: itensProcessados,
        total: totalFinal,
        valorFrete,
        desconto,
        cupomAplicado: cupomCodigo,
        cupomAplicadoId,
        enderecoEntrega: todosDigitais ? null : enderecoEntrega,
        status: "pendente",
      });

      // 6. INCREMENTAR USO DO CUPOM (APÓS O SUCESSO DA CRIAÇÃO DO PEDIDO)
      if (cupomAplicadoId) {
        await cupomService.incrementarUso(cupomAplicadoId);
      }
      
      // 7. CRIAR REGISTRO DE FRETE E ATUALIZAR ESTOQUE
      if (dadosFrete && !todosDigitais) {
        await Frete.create({ pedidoId: pedido.id, ...dadosFrete });
      }
      
      for (const item of itensProcessados) {
        if (!item.digital) {
            if (item.variacaoId) {
                const variacao = await VariacaoProduto.findByPk(item.variacaoId);
                if (variacao) { 
                  variacao.estoque -= item.quantidade; 
                  await variacao.save(); 
                }
            } else {
                const produto = await Produto.findByPk(item.produtoId);
                if (produto) { 
                  produto.estoque -= item.quantidade; 
                  await produto.save(); 
                }
            }
        }
      }

      return pedido;
    } catch (error) {
      console.error("Erro detalhado ao criar pedido no serviço:", error);
      throw error;
    }
  },

 async atualizarStatusPedido(pedidoId, status) {
    try {
      const pedido = await Pedido.findByPk(pedidoId, {
        include: [{ model: Usuario }],
      })

      if (!pedido) {
        throw new Error("Pedido não encontrado")
      }

      // Se o status anterior era "pendente" e agora está "cancelado", decrementa cupom
      if (pedido.status === "pendente" && status === "cancelado" && pedido.cupomAplicadoId) {
         await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }
       // Se o status anterior não era cancelado e agora é, decrementa
      else if (pedido.status !== "cancelado" && status === "cancelado" && pedido.cupomAplicadoId) {
          await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }


      pedido.status = status
      await pedido.save()

      // Enviar notificação automática
      try {
        await notificacaoService.enviarAtualizacaoStatus(pedidoId, status)
      } catch (emailError) {
        console.error("Erro ao enviar notificação:", emailError)
        // Não falhar a operação se o email falhar
      }

      // Enviar email de confirmação se status for "pago"
      if (status === "pago") {
        await enviarEmail(pedido.Usuario.email, "Pedido Confirmado", templateConfirmacaoPedido(pedido))
      }

      return pedido
    } catch (error) {
      throw error
    }
  },

   async listarPedidos(usuarioId, filtros = {}) {
    try {
      const { status, page = 1, limit = 10 } = filtros
      const where = {}
      if (usuarioId != null) where.usuarioId = usuarioId

      if (status) {
        where.status = status
      }

      const offset = (page - 1) * limit

      const { count, rows } = await Pedido.findAndCountAll({
        where,
        include: [{ model: Usuario, attributes: ["nome", "email"] }],
        limit: Number.parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      })

      // Mapear pedidos para incluir detalhes dos produtos nos itens
      const pedidosComDetalhes = await Promise.all(rows.map(async (pedido) => {
        const itensComDetalhes = await Promise.all(pedido.itens.map(async (item) => {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [{ model: ArquivoProduto, as: 'ArquivoProdutos' }]
          });
          
          let imagemUrl = null;
          if (produto && produto.ArquivoProdutos && produto.ArquivoProdutos.length > 0) {
            // A URL já vem completa do banco de dados, não é necessário adicionar prefixos.
            imagemUrl = produto.ArquivoProdutos[0].url;
          }

          return {
            ...item,
            produto: {
              id: produto ? produto.id : null,
              nome: produto ? produto.nome : 'Produto não encontrado',
              imagemUrl: imagemUrl
            }
          };
        }));
        
        // Retorna uma nova versão do objeto do pedido com os itens detalhados
        return { ...pedido.toJSON(), itens: itensComDetalhes };
      }));

      return {
        pedidos: pedidosComDetalhes,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number.parseInt(page),
      }
    } catch (error) {
      throw error;
    }
  },

  
  async buscarPedidoPorId(pedidoId) {
    try {
      const pedido = await Pedido.findByPk(pedidoId, {
        include: [{ model: Usuario, attributes: ["nome", "email"] }, { model: Pagamento }],
      })

      if (!pedido) {
        throw new Error("Pedido não encontrado")
      }

      return pedido
    } catch (error) {
      throw error
    }
  },
 async cancelarPedido(pedidoId) {
    try {
      const pedido = await Pedido.findByPk(pedidoId)
      if (!pedido) throw new Error("Pedido não encontrado")
      if (pedido.status === "entregue") throw new Error("Não é possível cancelar pedido já entregue")

      // Se o pedido tinha um cupom e NÃO estava cancelado, devolve o uso.
      if (pedido.cupomAplicadoId && pedido.status !== "cancelado") {
        await cupomService.decrementarUso(pedido.cupomAplicadoId);
      }

      // Restaurar estoque (código existente)
      for (const item of pedido.itens) {
        if (!item.digital) {
          if (item.variacaoId) {
            const variacao = await VariacaoProduto.findByPk(item.variacaoId)
            if (variacao) { variacao.estoque += item.quantidade; await variacao.save() }
          } else {
            const produto = await Produto.findByPk(item.produtoId)
            if (produto) { produto.estoque += item.quantidade; await produto.save() }
          }
        }
      }

      pedido.status = "cancelado"
      await pedido.save()
      return pedido
    } catch (error) {
      throw error
    }
  },

  async verificarSeUsuarioComprouProduto(usuarioId, produtoId) {
    try {
      const pedido = await Pedido.findOne({
        where: {
          usuarioId,
          status: "pago",
        },
      })

      if (!pedido) return false

      const comprouProduto = pedido.itens.some((item) => item.produtoId === produtoId)
      return comprouProduto
    } catch (error) {
      throw error
    }
  },

  async listarProdutosPagosPorUsuario(usuarioId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: "pago",
        },
      })

      const produtosPagos = []
      for (const pedido of pedidos) {
        for (const item of pedido.itens) {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [{ model: ArquivoProduto }],
          })
          if (produto) {
            produtosPagos.push({
              produtoId: produto.id,
              nome: produto.nome,
              arquivos: produto.ArquivoProdutos,
            })
          }
        }
      }

      return produtosPagos
    } catch (error) {
      throw error
    }
  },

  // FUNÇÃO CORRIGIDA
async obterDownloadsPorUsuario(usuarioId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: ['pago', 'processando', 'enviado', 'entregue', 'concluido'],
        },
        attributes: ['itens'],
      });

      const uniqueDigitalProductIds = new Set();

      for (const pedido of pedidos) {
        if (pedido.itens && Array.isArray(pedido.itens)) {
          for (const item of pedido.itens) {
            if (item.digital) { // Assume que a flag digital está no item do pedido
                 uniqueDigitalProductIds.add(item.produtoId);
            }
          }
        }
      }

      if (uniqueDigitalProductIds.size === 0) {
          return [];
      }

      // 2. Buscar os detalhes dos PRODUTOS digitais únicos, INCLUINDO SEUS ARQUIVOS DIGITAIS E IMAGEM PRINCIPAL via associação
      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';

      const produtosDigitaisComArquivos = await Produto.findAll({
        where: {
          id: { [Op.in]: Array.from(uniqueDigitalProductIds) },
          ativo: true, 
        },
        include: [{
          model: ArquivoProduto,
          as: 'ArquivoProdutos',
          // Inclui arquivos digitais E imagem principal
          where: { 
              [Op.or]: [
                  { tipo: 'arquivo' }, 
                  { tipo: 'imagem', principal: true } // Incluir a imagem principal
              ]
          }, 
          required: false // Não exige que o produto tenha arquivos (pode ter só a imagem principal)
        }],
        attributes: [
            'id', 
            'nome', 
            'slug', 
            'descricao', 
            // Não precisamos mais buscar 'imagens' ou 'itensDownload' como JSON aqui
        ], 
      });

      // 3. Formatar os dados para o frontend
      const downloadsFormatados = produtosDigitaisComArquivos.map(produto => {
        const produtoJSON = produto.toJSON();
        const arquivosDoProduto = produtoJSON.ArquivoProdutos || [];

        // Encontra a imagem principal (que veio na include, se existir)
        const imagemPrincipal = arquivosDoProduto.find(arq => arq.tipo === 'imagem' && arq.principal);
        // Formata a URL da imagem principal
        const imagemUrl = imagemPrincipal?.url ? new URL(imagemPrincipal.url.replace(/\\/g, '/'), baseUrl).href : 'https://placehold.co/80x80.png';

        // Filtra e formata APENAS os arquivos digitais para a lista de downloads
        const arquivosDigitaisFormatados = arquivosDoProduto
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url, // Caminho relativo /uploads/...
            fullUrl: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href, // URL completa para download
            mimeType: arq.mimeType,
            tamanho: arq.tamanho,
          }));

        return {
          produtoId: produtoJSON.id,
          nome: produtoJSON.nome, 
          slug: produtoJSON.slug, 
          descricao: produtoJSON.descricao,
          imagemUrl: imagemUrl, // URL completa da imagem principal
          arquivos: arquivosDigitaisFormatados, // Lista de arquivos digitais formatada
        };
      });

      // Opcional: Filtrar resultados para remover produtos que não tinham arquivos digitais tipo 'arquivo'
      // (se required: false e um produto só tinha a imagem principal, ele virá mas sem arquivos digitais)
       const downloadsComArquivosReais = downloadsFormatados.filter(item => item.arquivos.length > 0);


      // Retorna a lista final com nome, slug, imagem e arquivos
      return downloadsComArquivosReais;

    } catch (error) {
      console.error("Erro ao obter downloads do usuário:", error);
      if (error.original?.sqlMessage) {
           console.error("Detalhes do erro SQL:", error.original.sqlMessage, error.sql);
       }
       if (error.original?.code === 'ER_BAD_FIELD_ERROR') {
            throw new Error("Erro na estrutura do banco de dados. A coluna 'slug' pode estar faltando na tabela 'produtos'.");
       }
      throw error;
    }
  },

   async buscarProdutosRelacionados(idOuSlug, limite = 4) {
    try {
      // ... (mantido como antes, ele busca slug e formata URLs) ...
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
        // Aqui você pode escolher incluir ArquivoProduto OU usar a propriedade JSON 'imagens'
        // Se a versão antiga do modelo Produto tinha 'imagens' como JSON e o frontend lê de lá,
        // então NÃO inclua ArquivoProduto aqui para relacionados.
        // Mas o seu produtoService.listarProdutos e buscarProdutoPorId incluem ArquivoProdutos.
        // Vamos manter a consistência e incluir ArquivoProdutos, e formatar como array de URLs.
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false },
        ],
      });

      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
         // Formata o array de URLs de imagens a partir da associação ArquivoProduto
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1))
          .map(arq => new URL(arq.url.replace(/\\/g, '/'), baseUrl).href);
         // Limpa a associação ArquivoProdutos do objeto final se não quiser retorná-la diretamente
         delete p.ArquivoProdutos; 
        return p;
      });

      return produtosFormatados;

    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },

   async buscarProdutosRelacionados(produtoId, limite = 4) {
    try {
      const produtoAtual = await Produto.findByPk(produtoId);
      if (!produtoAtual || !produtoAtual.categoriaId) {
        return []; // Retorna vazio se o produto ou sua categoria não forem encontrados
      }

      const relacionados = await Produto.findAll({
        where: {
          categoriaId: produtoAtual.categoriaId,
          id: { [Op.ne]: produtoId }, // Exclui o próprio produto da lista
          ativo: true,
        },
        limit: parseInt(limite),
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false },
        ],
      });

      // Formata os produtos para o frontend, garantindo a URL completa da imagem
      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
        p.imagens = p.ArquivoProdutos
          ?.filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1))
          .map(arq => new URL(arq.url.replace(/\\/g, '/'), baseUrl).href);
        return p;
      });

      return produtosFormatados;

    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },


 async verificarSeUsuarioComprouProduto(usuarioId, produtoId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: {
            [Op.in]: ["pago", "processando", "enviado", "entregue", "concluido"], // Considera como "comprou" se o pedido está em um desses status
          },
        },
      })

      if (!pedidos || pedidos.length === 0) return false

      const comprouProduto = pedidos.some((pedido) =>
        pedido.itens.some((item) => item.produtoId === produtoId)
      )
      return comprouProduto
    } catch (error) {
      throw error
    }
  },

   async listarProdutosPagosPorUsuario(usuarioId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: {
            [Op.in]: ["pago", "processando", "enviado", "entregue", "concluido"],
          },
        },
      })

      const produtosPagos = []
      for (const pedido of pedidos) {
        for (const item of pedido.itens) {
          const produto = await Produto.findByPk(item.produtoId, {
            include: [{ model: ArquivoProduto }],
          })
          if (produto) {
            produtosPagos.push({
              produtoId: produto.id,
              nome: produto.nome,
              arquivos: produto.ArquivoProdutos,
            })
          }
        }
      }

      return produtosPagos
    } catch (error) {
      throw error
    }
  },

  async obterDownloadsPorUsuario(usuarioId) {
    try {
      const pedidos = await Pedido.findAll({
        where: {
          usuarioId,
          status: ['pago', 'processando', 'enviado', 'entregue', 'concluido'],
        },
        attributes: ['itens'],
      });

      const uniqueDigitalProductIds = new Set();

      for (const pedido of pedidos) {
        if (pedido.itens && Array.isArray(pedido.itens)) {
          for (const item of pedido.itens) {
            if (item.digital) { // Assume que a flag digital está no item do pedido
                 uniqueDigitalProductIds.add(item.produtoId);
            }
          }
        }
      }

      if (uniqueDigitalProductIds.size === 0) {
          return [];
      }

      // 2. Buscar os detalhes dos PRODUTOS digitais únicos, INCLUINDO SEUS ARQUIVOS DIGITAIS E IMAGEM PRINCIPAL via associação
      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';

      const produtosDigitaisComArquivos = await Produto.findAll({
        where: {
          id: { [Op.in]: Array.from(uniqueDigitalProductIds) },
          ativo: true, 
        },
        include: [{
          model: ArquivoProduto,
          as: 'ArquivoProdutos',
          // Inclui arquivos digitais E imagem principal
          where: { 
              [Op.or]: [
                  { tipo: 'arquivo' }, 
                  { tipo: 'imagem', principal: true } // Incluir a imagem principal
              ]
          }, 
          required: false // Não exige que o produto tenha arquivos (pode ter só a imagem principal)
        }],
        attributes: [
            'id', 
            'nome', 
            'slug', 
            'descricao', 
            // Não precisamos mais buscar 'imagens' ou 'itensDownload' como JSON aqui
        ], 
      });

      // 3. Formatar os dados para o frontend
      const downloadsFormatados = produtosDigitaisComArquivos.map(produto => {
        const produtoJSON = produto.toJSON();
        const arquivosDoProduto = produtoJSON.ArquivoProdutos || [];

        // Encontra a imagem principal (que veio na include, se existir)
        const imagemPrincipal = arquivosDoProduto.find(arq => arq.tipo === 'imagem' && arq.principal);
        // Formata a URL da imagem principal
        const imagemUrl = imagemPrincipal?.url ? new URL(imagemPrincipal.url.replace(/\\/g, '/'), baseUrl).href : 'https://placehold.co/80x80.png';

        // Filtra e formata APENAS os arquivos digitais para a lista de downloads
        const arquivosDigitaisFormatados = arquivosDoProduto
          .filter(arq => arq.tipo === 'arquivo')
          .map(arq => ({
            id: arq.id,
            nome: arq.nome,
            url: arq.url, // Caminho relativo /uploads/...
            fullUrl: new URL(arq.url.replace(/\\/g, '/'), baseUrl).href, // URL completa para download
            mimeType: arq.mimeType,
            tamanho: arq.tamanho,
          }));

        return {
          produtoId: produtoJSON.id,
          nome: produtoJSON.nome, 
          slug: produtoJSON.slug, 
          descricao: produtoJSON.descricao,
          imagemUrl: imagemUrl, // URL completa da imagem principal
          arquivos: arquivosDigitaisFormatados, // Lista de arquivos digitais formatada
        };
      });

      // Opcional: Filtrar resultados para remover produtos que não tinham arquivos digitais tipo 'arquivo'
      // (se required: false e um produto só tinha a imagem principal, ele virá mas sem arquivos digitais)
       const downloadsComArquivosReais = downloadsFormatados.filter(item => item.arquivos.length > 0);


      // Retorna a lista final com nome, slug, imagem e arquivos
      return downloadsComArquivosReais;

    } catch (error) {
      console.error("Erro ao obter downloads do usuário:", error);
      if (error.original?.sqlMessage) {
           console.error("Detalhes do erro SQL:", error.original.sqlMessage, error.sql);
       }
       if (error.original?.code === 'ER_BAD_FIELD_ERROR') {
            throw new Error("Erro na estrutura do banco de dados. A coluna 'slug' pode estar faltando na tabela 'produtos'.");
       }
      throw error;
    }
  },
  // ... (outras funções) ...
   async buscarProdutosRelacionados(idOuSlug, limite = 4) {
    try {
      // ... (mantido como antes, ele busca slug e formata URLs) ...
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
        // Aqui você pode escolher incluir ArquivoProduto OU usar a propriedade JSON 'imagens'
        // Se a versão antiga do modelo Produto tinha 'imagens' como JSON e o frontend lê de lá,
        // então NÃO inclua ArquivoProduto aqui para relacionados.
        // Mas o seu produtoService.listarProdutos e buscarProdutoPorId incluem ArquivoProdutos.
        // Vamos manter a consistência e incluir ArquivoProdutos, e formatar como array de URLs.
        include: [
          { model: ArquivoProduto, as: 'ArquivoProdutos', required: false },
          { model: VariacaoProduto, as: 'variacoes', required: false },
        ],
      });

      const baseUrl = process.env.BASE_URL || 'http://localhost:3035';
      const produtosFormatados = relacionados.map(produto => {
        const p = produto.toJSON();
         // Formata o array de URLs de imagens a partir da associação ArquivoProduto
        p.imagens = (p.ArquivoProdutos || [])
          .filter(arq => arq.tipo === 'imagem')
          .sort((a, b) => (a.principal ? -1 : 1) - (b.principal ? -1 : 1))
          .map(arq => new URL(arq.url.replace(/\\/g, '/'), baseUrl).href);
         // Limpa a associação ArquivoProdutos do objeto final se não quiser retorná-la diretamente
         delete p.ArquivoProdutos; 
        return p;
      });

      return produtosFormatados;

    } catch (error) {
      console.error("Erro ao buscar produtos relacionados:", error);
      throw error;
    }
  },

}

module.exports = pedidoService;