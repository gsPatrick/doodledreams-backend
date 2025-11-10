// server.js

// 1. Dependências
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path"); // Módulo para lidar com caminhos de arquivos
require('dotenv').config();

// 2. Conexão com o Banco de Dados e Modelos
const { sequelize } = require("./config/database");
const { Usuario } = require('./models');
const bcrypt = require('bcryptjs');

// 3. Middlewares
const tratarErros = require("./middleware/tratarErros");

// 4. Rotas da API
const authRoutes = require("./routes/authRoutes");
const produtoRoutes = require("./routes/produtoRoutes");
const pedidoRoutes = require("./routes/pedidoRoutes");
const cupomRoutes = require("./routes/cupomRoutes");
const blogRoutes = require("./routes/blogRoutes");
const downloadRoutes = require("./routes/downloadRoutes");
const freteRoutes =require("./routes/freteRoutes");
const usuarioRoutes = require("./routes/usuarioRoutes");
const categoriaRoutes = require("./routes/categoriaRoutes");
const enderecoRoutes = require("./routes/enderecoRoutes");
const avaliacaoRoutes = require("./routes/avaliacaoRoutes");
const pagamentoRoutes = require("./routes/pagamentoRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const favoritoRoutes = require("./routes/favoritoRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const configuracaoLojaRoutes = require("./routes/configuracaoLojaRoutes");
const viaCepRoutes = require("./routes/viaCepRoutes");
const relatorioRoutes = require("./routes/relatorioRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");

// 5. Inicialização do Express
const app = express();

// 6. Configuração de Middlewares de Segurança
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: "*", // Em produção, restrinja para o domínio do seu frontend, ex: 'http://localhost:3004'
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Limite de requisições para proteger contra ataques de força bruta
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
});
app.use(limiter);

// Middlewares para interpretar o corpo das requisições
app.use(express.json({ limit: "50mb" })); // Aumentado o limite para uploads maiores
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.set('trust proxy', 1);

// --- MUDANÇA PRINCIPAL AQUI ---
// Servir arquivos estáticos da pasta 'uploads'.
// Isso torna qualquer arquivo dentro de ./uploads acessível publicamente.
// Ex: http://localhost:3045/uploads/imagens/meu-arquivo.avif
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 7. Registro das Rotas da API
app.use("/api/auth", authRoutes);
app.use("/api/produtos", produtoRoutes);
app.use("/api/pedidos", pedidoRoutes);
app.use("/api/cupons", cupomRoutes);
app.use("/api/blog", blogRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/frete", freteRoutes);
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/categorias", categoriaRoutes);
app.use("/api/enderecos", enderecoRoutes);
app.use("/api/avaliacoes", avaliacaoRoutes);
app.use("/api/pagamentos", pagamentoRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/favoritos", favoritoRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/configuracoes/loja", configuracaoLojaRoutes);
app.use("/api/cep", viaCepRoutes);
app.use("/api/relatorios", relatorioRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

// Rota de teste da API
app.get("/", (req, res) => {
  res.json({ message: "API Atelie Raisa funcionando!" });
});

// 8. Middleware de Tratamento de Erros (deve ser o último `app.use`)
app.use(tratarErros);

// 9. Porta do Servidor
const PORT = process.env.PORT || 3045;

// 10. Função para criar o usuário admin padrão
async function criarAdminPadrao() {
  try {
    const adminEmail = "admin@admin.com";
    const adminSenha = "admin123";

    const adminExistente = await Usuario.findOne({ where: { email: adminEmail } });

    if (!adminExistente) {
      console.log("Usuário admin padrão não encontrado. Criando...");
      const senhaHash = await bcrypt.hash(adminSenha, 10);
      await Usuario.create({
        nome: "Administrador Padrão",
        email: adminEmail,
        senhaHash: senhaHash,
        tipo: "admin",
        ativo: true,
      });
      console.log("Usuário admin padrão criado com sucesso!");
    } else {
      console.log("Usuário admin padrão já existe.");
    }
  } catch (error) {
    console.error("Erro ao tentar criar o usuário admin padrão:", error);
  }
}

// 11. Função de Inicialização do Servidor
async function iniciarServidor() {
  try {
    await sequelize.authenticate();
    console.clear();
    console.log("Conexão com banco de dados estabelecida com sucesso.");

    // Sincroniza os modelos com o banco
    // { alter: true } é seguro para desenvolvimento, pois tenta atualizar as tabelas sem apagar dados.
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
await sequelize.sync({ force: true }); // recria as tabelas
await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log("Modelos sincronizados com o banco de dados.");

    // Após a sincronização, verifica/cria o admin
    await criarAdminPadrao();

    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error("Erro ao conectar com banco de dados ou iniciar o servidor:", error);
  }
}

// 12. Iniciar o Servidor
iniciarServidor();