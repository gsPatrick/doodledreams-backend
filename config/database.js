const { Sequelize } = require("sequelize");
require("dotenv").config(); // Essencial para ler as variáveis de ambiente

// Determina qual URL de banco de dados usar
const isProduction = process.env.NODE_ENV === 'production';

// Se estiver em produção, usa a URL INTERNA. Caso contrário, usa a EXTERNA.
const DATABASE_URL = isProduction 
  ? process.env.DATABASE_URL_INTERNAL 
  : process.env.DATABASE_URL_EXTERNAL;

// Validação para garantir que a variável foi encontrada
if (!DATABASE_URL) {
  throw new Error("A URL de conexão com o banco de dados não foi definida no ambiente. Verifique seu arquivo .env ou as variáveis de ambiente do servidor.");
}

console.log(`Conectando ao banco de dados em ambiente de: ${isProduction ? 'Produção (Interno)' : 'Desenvolvimento (Externo)'}`);

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  dialectOptions: {
    ssl: {
      require: false,
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
});

module.exports = { sequelize };