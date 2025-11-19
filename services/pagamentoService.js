const mercadopago = require("../config/mercadoPago");
const { Pagamento, Pedido, Usuario, AssinaturaUsuario, PlanoAssinatura } = require("../models");
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

  async processarPagamentoCartao(dados, usuarioId) {
  try {
    const { pedidoId, token, payment_method_id, issuer_id, installments, payer } = dados;

    console.log('🔍 [INÍCIO] Processando pagamento com cartão...');
    console.log('   Dados recebidos do controller:', { pedidoId, token, payment_method_id, issuer_id, installments, payer });

    if (!token) throw new Error("Token do cartão não fornecido");
    if (!payment_method_id) throw new Error("ID do método de pagamento (payment_method_id) não fornecido");
    if (!issuer_id) throw new Error("ID do emissor (issuer_id) não fornecido");
    if (!payer || !payer.identification || !payer.email) throw new Error("Dados do pagador (email e documento) estão incompletos");

    const pedido = await Pedido.findOne({ where: { id: pedidoId, usuarioId } });
    if (!pedido) throw new Error(`Pedido ID ${pedidoId} não encontrado ou não pertence ao usuário ID ${usuarioId}.`);
    if (pedido.status !== 'pendente') throw new Error(`Este pedido (ID: ${pedidoId}) já foi processado. Status atual: ${pedido.status}.`);

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

    console.log('📥 [API_RESPONSE] Resposta recebida do Mercado Pago:', paymentResult);

    await Pagamento.create({
      pedidoId,
      usuarioId,
      valor: paymentResult.transaction_amount,
      metodo: "mercado_pago_api_card",
      status: paymentResult.status === 'approved' ? 'aprovado' : paymentResult.status,
      transacaoId: paymentResult.id,
      dadosTransacao: paymentResult,
    });
    console.log(`   Registro de pagamento criado no banco para o pedido ID ${pedidoId}.`);

    if (paymentResult.status === 'approved') {
      await pedidoService.atualizarStatusPedido(pedido.id, "pago");
      console.log(`   Status do pedido ID ${pedido.id} atualizado para 'pago'.`);
      facebookCapiService.sendPurchaseEvent(pedido, usuario);
    } else if (paymentResult.status === 'rejected') {
      await pedido.update({ status: 'cancelado' });
      console.log(`   Pagamento rejeitado. Status do pedido ID ${pedido.id} atualizado para 'cancelado'.`);
    }

    console.log('✅ [FIM] Processamento de pagamento com cartão finalizado com sucesso.');
    
    return {
      status: paymentResult.status,
      status_detail: paymentResult.status_detail,
      id: paymentResult.id,
    };

  } catch (error) {
    console.error("❌ [ERRO] Erro ao processar pagamento com cartão:", error.message);
    if (error.response?.data) {
      console.error("   Detalhes do erro do Mercado Pago:", JSON.stringify(error.response.data, null, 2));
      const mpError = error.response.data.cause?.[0]?.description || error.response.data.message || "Erro desconhecido do provedor de pagamento.";
      throw new Error(`Falha no pagamento: ${mpError}`);
    }
    
    throw new Error("Falha ao processar o pagamento com cartão.");
  }
},

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

      // CORREÇÃO CRÍTICA: Garantir que last_name nunca seja vazio
      const primeiroNome = usuario.nome.split(' ')[0] || 'Cliente';
      // Se não tiver sobrenome, usamos 'Sobrenome' ou repetimos o nome para satisfazer a API
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

      console.log('Enviando dados Pix para MP:', JSON.stringify(payment_data, null, 2));

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
      // LOG DETALHADO PARA O CONSOLE DO SERVIDOR
      console.error("Erro ao gerar pagamento PIX (Detalhes):", error);
      if (error.response && error.response.data) {
          console.error("Resposta de erro do Mercado Pago:", JSON.stringify(error.response.data, null, 2));
          
          // Tenta extrair a mensagem exata do erro
          const causa = error.response.data.cause;
          if (causa && causa.length > 0) {
             const msgErro = causa[0].description || causa[0].code;
             throw new Error(`Erro Mercado Pago: ${msgErro}`);
          }
          throw new Error(`Erro Mercado Pago: ${error.response.data.message}`);
      }
      
      // Lança o erro original se tiver mensagem, ou o genérico
      throw new Error(error.message || "Falha ao gerar o pagamento PIX.");
    }
  },

   async criarAssinaturaComCartao(dados, usuarioId) {
    try {
        const { planoId, token, frequencia, quantidade } = dados;

        const plano = await PlanoAssinatura.findByPk(planoId);
        if (!plano) throw new Error("Plano de assinatura não encontrado.");

        const usuario = await Usuario.findByPk(usuarioId);

        // Lógica de cálculo do valor da assinatura (pode ser mais complexa)
        const valorTotal = Number(plano.preco) * Number(quantidade);

        const subscriptionData = {
            reason: `Assinatura ${plano.nome} x${quantidade}`,
            auto_recurring: {
                frequency: frequencia, // 20, 30 ou 60
                frequency_type: 'days',
                transaction_amount: valorTotal,
                currency_id: 'BRL',
            },
            card_token_id: token,
            payer_email: usuario.email,
            back_url: `${process.env.FRONTEND_URL}/conta/assinaturas`,
            status: 'authorized',
        };

        const subResponse = await mercadopago.preapproval.create(subscriptionData);
        const subResult = subResponse.body;

        if (subResult.status !== 'authorized') {
            throw new Error(`Falha ao criar assinatura. Status: ${subResult.status}`);
        }

        // Salva a assinatura no nosso banco de dados
        const proximaCobranca = new Date();
        proximaCobranca.setDate(proximaCobranca.getDate() + Number(frequencia));
        
        await AssinaturaUsuario.create({
            usuarioId,
            planoId,
            status: 'ativa',
            mercadoPagoSubscriptionId: subResult.id,
            dataProximoCobranca: proximaCobranca,
            valorFrete: 0, // Ajustar se o frete for cobrado na assinatura
            metodoFrete: 'A definir', // Ajustar
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

  async processarWebhook(dados) {
    try {
      const { type, data, action } = dados;

      if (type === "payment") {
        const paymentId = data.id

        const payment = await mercadopago.payment.findById(paymentId)
        const paymentData = payment.body

        const pedidoId = paymentData.external_reference

        if (!pedidoId) {
          console.log("Webhook sem external_reference")
          return
        }

        const pagamento = await Pagamento.findOne({
          where: { pedidoId },
          include: [{ 
            model: Pedido, 
            include: [{ model: Usuario }] // <-- Aninhar a inclusão do Usuário
          }],
        })

        if (!pagamento) {
          console.log(`Pagamento não encontrado para pedido ${pedidoId}`)
          return
        }

        let novoStatus = "pendente"

        switch (paymentData.status) {
          case "approved":
            novoStatus = "aprovado"
            break
          case "rejected":
            novoStatus = "rejeitado"
            break
          case "cancelled":
            novoStatus = "cancelado"
            break
          case "pending":
          case "in_process":
            novoStatus = "pendente"
            break
        }

        await pagamento.update({
          status: novoStatus,
          dadosTransacao: paymentData,
        })

        if (novoStatus === "aprovado") {
          await pedidoService.atualizarStatusPedido(pedidoId, "pago");

          // !! ESTE É O LOCAL CORRETO PARA ENVIAR O EVENTO !!
          if (pagamento.Pedido && pagamento.Pedido.Usuario) {
             facebookCapiService.sendPurchaseEvent(pagamento.Pedido, pagamento.Pedido.Usuario);
          } else {
             console.error(`Facebook CAPI: Não foi possível enviar evento para o pedido #${pedidoId} pois os dados do pedido ou usuário não foram carregados.`);
          }
          
        } else if (novoStatus === "rejeitado" || novoStatus === "cancelado") {
          await pedidoService.cancelarPedido(pedidoId)
        }

        console.log(`Pagamento ${paymentId} atualizado para ${novoStatus}`)
      } else if (type === "preapproval") {
        // ... (seu código de assinatura permanece o mesmo)
      }
    } catch (error) {
      console.error("Erro ao processar webhook:", error)
      throw error
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

module.exports = pagamentoService