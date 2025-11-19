const mercadopago = require("../config/mercadoPago");
const { Pagamento, Pedido, Usuario, AssinaturaUsuario, PlanoAssinatura, Produto } = require("../models");
const pedidoService = require("./pedidoService");
const facebookCapiService = require("./facebookCapiService");
const { v4: uuidv4 } = require('uuid');

// Helper para formatar datas em ISO com offset para MercadoPago
function formatDateToPreference(date) {
  const pad = (n) => String(n).padStart(2, '0')
  const padMs = (n) => String(n).padStart(3, '0')
  
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const ms = padMs(date.getMilliseconds())
  
  const offset = -date.getTimezoneOffset()
  const offsetHours = Math.floor(Math.abs(offset) / 60)
  const offsetMinutes = Math.abs(offset) % 60
  const offsetSign = offset >= 0 ? '-' : '+'
  const offsetFormatted = `${offsetSign}${pad(offsetHours)}:${pad(offsetMinutes)}`
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetFormatted}`
}

function getMercadoPagoDateFormat(date) {
  return date.toISOString().replace('Z', '-03:00'); // Força o fuso de Brasília (GMT-3)
}

const pagamentoService = {
  
  // --- 1. CHECKOUT PRO (Redirecionamento) ---
  async criarCheckoutPro(pedidoId, usuarioId) {
    try {
      const pedido = await Pedido.findOne({
        where: { id: pedidoId, usuarioId },
        include: [{ model: Usuario }],
      });

      if (!pedido) throw new Error("Pedido não encontrado");
      if (pedido.status !== "pendente") throw new Error("Pedido já foi processado");

      const items = pedido.itens.map((item) => ({
        id: item.variacaoId ? item.variacaoId.toString() : item.produtoId.toString(),
        title: item.nome,
        unit_price: Number(item.preco),
        quantity: item.quantidade,
        category_id: "virtual_goods", // Categoria genérica
      }));

      if (pedido.valorFrete && pedido.valorFrete > 0) {
        items.push({
          id: "frete",
          title: "Custo de Envio",
          unit_price: Number(pedido.valorFrete),
          quantity: 1,
          category_id: "shipping",
        });
      }

      const now = new Date();
      const expirationDate = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // Expira em 24 horas

      const preference = {
        items,
        payer: { name: pedido.Usuario.nome, email: pedido.Usuario.email },
        back_urls: {
          success: `${process.env.FRONTEND_URL}/pagamento/sucesso?pedido=${pedidoId}`,
          failure: `${process.env.FRONTEND_URL}/pagamento/erro?pedido=${pedidoId}`,
          pending: `${process.env.FRONTEND_URL}/pagamento/pendente?pedido=${pedidoId}`,
        },
        auto_return: "approved",
        external_reference: pedidoId.toString(),
        notification_url: `${process.env.BASE_URL}/api/pagamentos/webhook`,
        statement_descriptor: "BUDDYBOOST"
      };

      const response = await mercadopago.preferences.create(preference);

      await Pagamento.create({
        pedidoId,
        usuarioId,
        valor: pedido.total,
        metodo: "mercado_pago",
        status: "pendente",
        transacaoId: response.body.id,
        dadosTransacao: response.body,
      });

      return {
        checkoutUrl: response.body.init_point,
        preferenceId: response.body.id,
      };
    } catch (error) {
      console.error("Erro ao criar checkout:", error);
      throw error;
    }
  },

  // --- 2. PAGAMENTO CARTÃO TRANSPARENTE (Brick) ---
  async processarPagamentoCartao(dados, usuarioId) {
    try {
      const { pedidoId, token, payment_method_id, issuer_id, installments, payer } = dados;

      console.log('🔍 [INÍCIO] Processando pagamento com cartão...');
      
      if (!token) throw new Error("Token do cartão não fornecido");
      if (!payment_method_id) throw new Error("ID do método de pagamento (payment_method_id) não fornecido");
      if (!issuer_id) throw new Error("ID do emissor (issuer_id) não fornecido");
      if (!payer || !payer.identification || !payer.email) throw new Error("Dados do pagador incompletos");

      const pedido = await Pedido.findOne({ where: { id: pedidoId, usuarioId } });
      if (!pedido) throw new Error(`Pedido ID ${pedidoId} não encontrado.`);
      if (pedido.status !== 'pendente') throw new Error(`Este pedido já foi processado.`);

      const usuario = await Usuario.findByPk(usuarioId);
      if (!usuario) throw new Error(`Usuário ID ${usuarioId} não encontrado.`);

      const identificationNumberClean = String(payer.identification.number).replace(/\D/g, '');
      if (!identificationNumberClean) throw new Error("Número de identificação (CPF/CNPJ) do pagador é obrigatório.");

      // Correção do nome/sobrenome para evitar erros do Mercado Pago
      const primeiroNome = usuario.nome.split(' ')[0] || 'Cliente';
      const ultimoNome = usuario.nome.includes(' ') ? usuario.nome.split(' ').slice(1).join(' ') : 'Sobrenome';

      const payment_data = {
        transaction_amount: Number(pedido.total),
        token: token,
        description: `Pedido #${pedido.id} - Buddy Boost`,
        installments: Number(installments),
        payment_method_id: payment_method_id,
        issuer_id: String(issuer_id),
        payer: {
          email: payer.email,
          first_name: primeiroNome,
          last_name: ultimoNome,
          identification: {
            type: payer.identification.type,
            number: identificationNumberClean,
          },
        },
        external_reference: String(pedido.id),
        notification_url: `${process.env.BASE_URL}/api/pagamentos/webhook`,
        statement_descriptor: "BUDDYBOOST",
      };

      console.log('📤 [API_CALL] Enviando payload para o Mercado Pago:', JSON.stringify(payment_data, null, 2));

      const paymentResponse = await mercadopago.payment.create(payment_data);
      const paymentResult = paymentResponse.body;

      console.log('📥 [API_RESPONSE] Status:', paymentResult.status);

      await Pagamento.create({
        pedidoId,
        usuarioId,
        valor: paymentResult.transaction_amount,
        metodo: "mercado_pago_api_card",
        status: paymentResult.status === 'approved' ? 'aprovado' : paymentResult.status,
        transacaoId: paymentResult.id,
        dadosTransacao: paymentResult,
      });

      if (paymentResult.status === 'approved') {
        await pedidoService.atualizarStatusPedido(pedido.id, "pago");
        facebookCapiService.sendPurchaseEvent(pedido, usuario);
      } else if (paymentResult.status === 'rejected') {
        await pedido.update({ status: 'cancelado' });
      }
      
      return {
        status: paymentResult.status,
        status_detail: paymentResult.status_detail,
        id: paymentResult.id,
      };

    } catch (error) {
      console.error("❌ [ERRO] Erro ao processar pagamento com cartão:", error.message);
      if (error.response?.data) {
        const mpError = error.response.data.cause?.[0]?.description || error.response.data.message || "Erro desconhecido.";
        throw new Error(`Falha no pagamento: ${mpError}`);
      }
      throw new Error("Falha ao processar o pagamento com cartão.");
    }
  },

  // --- 3. PAGAMENTO PIX ---
  async gerarPagamentoPix(dados, usuarioId) { 
    try {
      const { pedidoId, payer } = dados; 

      if (!payer || !payer.identification || !payer.identification.number) {
        throw new Error("CPF do pagador é obrigatório para gerar Pix.");
      }

      const pedido = await Pedido.findOne({ where: { id: pedidoId, usuarioId } });
      if (!pedido) throw new Error("Pedido não encontrado ou não pertence ao usuário.");
      if (pedido.status !== 'pendente') throw new Error("Este pedido já foi processado.");

      const usuario = await Usuario.findByPk(usuarioId);
      
      const expirationDate = new Date();
      expirationDate.setMinutes(expirationDate.getMinutes() + 30);

      // Correção CRÍTICA: Garantir que last_name nunca seja vazio
      const primeiroNome = usuario.nome.split(' ')[0] || 'Cliente';
      const ultimoNome = usuario.nome.includes(' ') ? usuario.nome.split(' ').slice(1).join(' ') : 'Sobrenome';
      
      const cpfLimpo = String(payer.identification.number).replace(/\D/g, '');

      const payment_data = {
        transaction_amount: Number(pedido.total),
        description: `Pedido #${pedido.id} - Buddy Boost`,
        payment_method_id: 'pix',
        payer: {
          email: usuario.email,
          first_name: primeiroNome,
          last_name: ultimoNome,
          identification: {
            type: 'CPF',
            number: cpfLimpo, 
          },
        },
        external_reference: pedido.id.toString(),
        notification_url: `${process.env.BASE_URL}/api/pagamentos/webhook`,
        date_of_expiration: expirationDate.toISOString().replace('Z', '-03:00'),
      };

      const paymentResponse = await mercadopago.payment.create(payment_data);
      const paymentResult = paymentResponse.body;

      await Pagamento.create({
        pedidoId,
        usuarioId,
        valor: paymentResult.transaction_amount,
        metodo: "mercado_pago_api_pix",
        status: 'pendente',
        transacaoId: paymentResult.id,
        dadosTransacao: paymentResult,
      });

      return {
        paymentId: paymentResult.id,
        qr_code: paymentResult.point_of_interaction.transaction_data.qr_code,
        qr_code_base64: paymentResult.point_of_interaction.transaction_data.qr_code_base64,
      };

    } catch (error) {
      console.error("Erro ao gerar pagamento PIX (Detalhes):", error);
      if (error.response && error.response.data) {
          const causa = error.response.data.cause;
          if (causa && causa.length > 0) {
             const msgErro = causa[0].description || causa[0].code;
             throw new Error(`Erro Mercado Pago: ${msgErro}`);
          }
          throw new Error(`Erro Mercado Pago: ${error.response.data.message}`);
      }
      throw new Error(error.message || "Falha ao gerar o pagamento PIX.");
    }
  },

   // --- 4. ASSINATURAS (Recorrência) ---
   async criarAssinaturaComCartao(dados, usuarioId) {
    try {
        const { token, frequencia, quantidade, produtoId, enderecoEntrega } = dados;

        // Busca detalhes para o "snapshot" da assinatura
        const produto = await Produto.findByPk(produtoId);
        if (!produto) throw new Error("Produto da assinatura não encontrado.");

        const usuario = await Usuario.findByPk(usuarioId);
        if (!usuario) throw new Error("Usuário não encontrado.");

        // Calcula valor total (Preço x Quantidade)
        const valorTotal = Number(produto.preco) * Number(quantidade);

        // SERIALIZAÇÃO DE DADOS: Aqui salvamos tudo o que o webhook precisa
        // para criar pedidos automáticos no futuro.
        const referenceData = {
            tipo: "assinatura_produto",
            usuarioId: usuario.id,
            produtoId: produto.id,
            quantidade: quantidade,
            enderecoEntrega: enderecoEntrega 
        };

        const subscriptionData = {
            reason: `Assinatura: ${produto.nome} (A cada ${frequencia} dias)`,
            auto_recurring: {
                frequency: Number(frequencia),
                frequency_type: 'days',
                transaction_amount: valorTotal,
                currency_id: 'BRL',
            },
            card_token_id: token,
            payer_email: usuario.email,
            back_url: `${process.env.FRONTEND_URL}/conta/assinaturas`,
            status: 'authorized',
            external_reference: JSON.stringify(referenceData) // JSON Stringified
        };

        console.log("Criando assinatura no MP:", JSON.stringify(subscriptionData, null, 2));

        const subResponse = await mercadopago.preapproval.create(subscriptionData);
        const subResult = subResponse.body;

        if (subResult.status !== 'authorized') {
            throw new Error(`Falha ao criar assinatura. Status: ${subResult.status}`);
        }

        // Salva a assinatura no banco local para gestão
        const proximaCobranca = new Date();
        proximaCobranca.setDate(proximaCobranca.getDate() + Number(frequencia));
        
        await AssinaturaUsuario.create({
            usuarioId,
            mercadoPagoSubscriptionId: subResult.id,
            status: 'ativa',
            dataProximoCobranca: proximaCobranca,
            valorFrete: 0, 
            metodoFrete: 'Assinatura Padrão',
        });

        return {
            status: subResult.status,
            subscriptionId: subResult.id,
        };

    } catch (error) {
        console.error("Erro ao criar assinatura:", error.response ? error.response.data : error.message);
        throw new Error("Falha ao criar a assinatura.");
    }
  },

  // --- 5. WEBHOOK (Ouvinte de Eventos) ---
  async processarWebhook(dados) {
    try {
      const { type, data } = dados;

      // TIPO A: Atualização de Status da Assinatura
      if (type === "preapproval") {
          const preapprovalId = data.id;
          const preapproval = await mercadopago.preapproval.findById(preapprovalId);
          const status = preapproval.body.status;
          
          const assinatura = await AssinaturaUsuario.findOne({ where: { mercadoPagoSubscriptionId: preapprovalId }});
          if (assinatura) {
              assinatura.status = status === 'authorized' ? 'ativa' : status;
              await assinatura.save();
              console.log(`Assinatura ${preapprovalId} atualizada para: ${status}`);
          }
      }

      // TIPO B: Pagamento (Pode ser pedido avulso OU recorrência de assinatura)
      if (type === "payment") {
        const paymentId = data.id;
        const payment = await mercadopago.payment.findById(paymentId);
        const paymentData = payment.body;

        let externalRef = paymentData.external_reference;
        
        // --- LÓGICA DE RECORRÊNCIA AUTOMÁTICA ---
        try {
            // Tenta ler como JSON (indicativo de assinatura)
            const refData = JSON.parse(externalRef);

            if (refData && refData.tipo === "assinatura_produto" && paymentData.status === "approved") {
                console.log("🔄 Pagamento de recorrência detectado! Criando pedido automático...");
                
                const pagamentoExistente = await Pagamento.findOne({ where: { transacaoId: String(paymentId) } });
                if (pagamentoExistente) {
                    console.log("Pagamento de recorrência já processado anteriormente.");
                    return;
                }

                // 1. Cria o Pedido Automaticamente
                const itensPedido = [{
                    produtoId: refData.produtoId,
                    quantidade: refData.quantidade
                }];

                const novoPedido = await pedidoService.criarPedido(
                    refData.usuarioId,
                    itensPedido,
                    refData.enderecoEntrega,
                    'frete_fixo_nacional' // Frete fixo ou lógica customizada para assinantes
                );

                // 2. Atualiza o Pedido para Pago
                await pedidoService.atualizarStatusPedido(novoPedido.id, "pago");

                // 3. Registra o Pagamento
                await Pagamento.create({
                    pedidoId: novoPedido.id,
                    usuarioId: refData.usuarioId,
                    valor: paymentData.transaction_amount,
                    metodo: "mercado_pago_assinatura",
                    status: "aprovado",
                    transacaoId: String(paymentId),
                    dadosTransacao: paymentData,
                });

                console.log(`✅ Pedido de assinatura #${novoPedido.id} criado com sucesso via Webhook!`);
                return; // Encerra aqui pois foi uma assinatura
            }
        } catch (e) {
            // Não é JSON, então é um pedido normal (external_reference = ID do pedido)
            // Segue fluxo normal abaixo...
        }

        // --- FLUXO NORMAL (PEDIDO AVULSO) ---
        const pedidoId = externalRef; 

        if (!pedidoId || isNaN(pedidoId)) {
          console.log("Webhook ignorado: external_reference inválido ou ausente.");
          return;
        }

        const pagamento = await Pagamento.findOne({
          where: { pedidoId },
          include: [{ model: Pedido, include: [{ model: Usuario }] }],
        });

        if (!pagamento) {
          console.log(`Pagamento inicial não encontrado para pedido ${pedidoId}`);
          return;
        }

        let novoStatus = "pendente";
        switch (paymentData.status) {
          case "approved": novoStatus = "aprovado"; break;
          case "rejected": novoStatus = "rejeitado"; break;
          case "cancelled": novoStatus = "cancelado"; break;
          case "pending":
          case "in_process": novoStatus = "pendente"; break;
        }

        await pagamento.update({
          status: novoStatus,
          dadosTransacao: paymentData,
        });

        if (novoStatus === "aprovado") {
          await pedidoService.atualizarStatusPedido(pedidoId, "pago");
          if (pagamento.Pedido && pagamento.Pedido.Usuario) {
             facebookCapiService.sendPurchaseEvent(pagamento.Pedido, pagamento.Pedido.Usuario);
          }
        } else if (novoStatus === "rejeitado" || novoStatus === "cancelado") {
          await pedidoService.cancelarPedido(pedidoId);
        }
        console.log(`Pagamento ${paymentId} (Pedido ${pedidoId}) atualizado para ${novoStatus}`);
      } 
    } catch (error) {
      console.error("Erro ao processar webhook:", error);
    }
  },

  async verificarStatusPagamento(pedidoId) {
    try {
      const pagamento = await Pagamento.findOne({
        where: { pedidoId },
        include: [{ model: Pedido }],
      })

      if (!pagamento) {
        throw new Error("Pagamento não encontrado")
      }

      if (pagamento.transacaoId) {
        try {
          const payment = await mercadopago.payment.findById(pagamento.transacaoId)
          const paymentData = payment.body

          let statusAtualizado = pagamento.status

          switch (paymentData.status) {
            case "approved":
              statusAtualizado = "aprovado"
              break
            case "rejected":
              statusAtualizado = "rejeitado"
              break
            case "cancelled":
              statusAtualizado = "cancelado"
              break
          }

          if (statusAtualizado !== pagamento.status) {
            await pagamento.update({ status: statusAtualizado })
          }
        } catch (mpError) {
          console.error("Erro ao verificar status no MP:", mpError)
        }
      }

      return pagamento
    } catch (error) {
      throw error
    }
  },

  async listarPagamentos(filtros = {}) {
    try {
      const { usuarioId, status, page = 1, limit = 10 } = filtros
      const where = {}

      if (usuarioId) where.usuarioId = usuarioId
      if (status) where.status = status

      const offset = (page - 1) * limit

      const { count, rows } = await Pagamento.findAndCountAll({
        where,
        include: [{ model: Pedido }, { model: Usuario, attributes: ["nome", "email"] }],
        limit: Number.parseInt(limit),
        offset,
        order: [["createdAt", "DESC"]],
      })

      return {
        pagamentos: rows,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number.parseInt(page),
      }
    } catch (error) {
      throw error
    }
  },
}

module.exports = pagamentoService;