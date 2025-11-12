const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
require('dotenv').config();

const { sequelize } = require("./config/database")
require('./models'); 
const tratarErros = require("./middleware/tratarErros")
const swaggerUi = require('swagger-ui-express');

// --- NOVO: Importar o authService e o modelo Usuario ---
const authService = require("./services/authService");
const { Usuario } = require("./models");
// --------------------------------------------------------

const path = require("path")
// Importar rotas
const authRoutes = require("./routes/authRoutes")
const produtoRoutes = require("./routes/produtoRoutes")
const pedidoRoutes = require("./routes/pedidoRoutes")
const cupomRoutes = require("./routes/cupomRoutes")
const blogRoutes = require("./routes/blogRoutes")
const downloadRoutes = require("./routes/downloadRoutes")
const freteRoutes = require("./routes/freteRoutes")
const usuarioRoutes = require("./routes/usuarioRoutes")
const categoriaRoutes = require("./routes/categoriaRoutes")
const enderecoRoutes = require("./routes/enderecoRoutes")
const avaliacaoRoutes = require("./routes/avaliacaoRoutes")
const pagamentoRoutes = require("./routes/pagamentoRoutes")
const uploadRoutes = require("./routes/uploadRoutes")
const favoritoRoutes = require("./routes/favoritoRoutes")
const dashboardRoutes = require("./routes/dashboardRoutes")
const configuracaoLojaRoutes = require("./routes/configuracaoLojaRoutes")
const viaCepRoutes = require("./routes/viaCepRoutes")
const relatorioRoutes = require("./routes/relatorioRoutes")
const subscriptionRoutes = require("./routes/subscriptionRoutes")

const app = express()

// Middleware de segurança
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}))
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
})
app.use(limiter)

// Middleware para parsing
app.use(express.json({ limit: "500mb" }))
app.use(express.urlencoded({ extended: true, limit: "500mb" }))
app.set('trust proxy', 1)

// Rotas
app.use("/api/auth", authRoutes)
app.use("/api/produtos", produtoRoutes)
app.use("/api/pedidos", pedidoRoutes)
app.use("/api/cupons", cupomRoutes)
app.use("/api/blog", blogRoutes)
app.use("/api/downloads", downloadRoutes)
app.use("/api/frete", freteRoutes)
app.use("/api/usuarios", usuarioRoutes)
app.use("/api/categorias", categoriaRoutes)
app.use("/api/enderecos", enderecoRoutes)
app.use("/api/avaliacoes", avaliacaoRoutes)
app.use("/api/pagamentos", pagamentoRoutes)
app.use("/api/uploads", uploadRoutes)
app.use("/api/favoritos", favoritoRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/configuracoes/loja", configuracaoLojaRoutes)
app.use("/api/cep", viaCepRoutes)
app.use("/api/relatorios", relatorioRoutes)
app.use("/api/subscriptions", subscriptionRoutes)

// Servir arquivos estáticos da pasta uploads
app.use("/uploads", express.static("uploads"))

// Middleware de tratamento de erros
app.use(tratarErros)

// Rota de teste
app.get("/", (req, res) => {
  res.json({ message: "API Ecommerce funcionando!" })
})

// Configurar Swagger UI
const swaggerFile = require('./swagger-output.json');
app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerFile));

const PORT = process.env.PORT || 3001

// --- NOVO: Função para criar o administrador padrão ---
async function criarAdminPadrao() {
  const adminEmail = "admin@admin.com";
  const adminSenha = "admin123";

  try {
    console.log("Verificando a existência do administrador padrão...");
    const adminExistente = await Usuario.findOne({ where: { email: adminEmail } });

    if (!adminExistente) {
      console.log("Administrador padrão não encontrado. Criando novo administrador...");
      await authService.criarUsuarioAdmin({
        nome: "Administrador",
        email: adminEmail,
        senha: adminSenha,
      });
      console.log("Administrador padrão criado com sucesso!");
    } else {
      console.log("Administrador padrão já existe.");
    }
  } catch (error) {
    console.error("Erro CRÍTICO ao tentar criar o administrador padrão:", error);
  }
}
// ----------------------------------------------------

// Inicializar servidor
async function iniciarServidor() {
  try {
    await sequelize.authenticate()
    console.clear()
    console.log("Conexão com banco de dados estabelecida.")

    try {
      // Usar { alter: true } para desenvolvimento.
      // Isso atualiza as tabelas para corresponder aos modelos sem apagar os dados.
      await sequelize.sync({ force: true }); 
      console.log("Modelos sincronizados com o banco de dados.");

    } catch (syncError) {
      console.error("Erro ao sincronizar modelos:", syncError)
    }

    // --- NOVO: Chamar a função para criar o admin ---
    await criarAdminPadrao();
    // ---------------------------------------------

    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`)
    })
  } catch (error) {
    console.error("Erro ao conectar com banco de dados:", error)
  }
}

// Iniciar servidor
iniciarServidor();