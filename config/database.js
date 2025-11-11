const { Sequelize } = require("sequelize")
// require("dotenv").config() // Não precisamos mais do dotenv para esta conexão hardcoded

// --- MUDANÇA PRINCIPAL AQUI ---
// A URL de conexão foi trocada pela URL Externa do seu painel PostgreSQL
const DATABASE_URL = "postgres://bdrevestese:bdrevestese@69.62.99.122:9191/bdrevestese?sslmode=disable";

const sequelize = new Sequelize(DATABASE_URL, {
  // 1. O dialeto agora é 'postgres'
  dialect: "postgres", 
  
  // 2. Opções específicas para produção com PostgreSQL em certas plataformas
  dialectOptions: {
    ssl: {
      require: false, // O parâmetro ?sslmode=disable na URL já cuida disso
      rejectUnauthorized: false 
    }
  },
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
})

module.exports = { sequelize }