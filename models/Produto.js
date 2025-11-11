// src/models/produto.js

const { DataTypes } = require("sequelize")
const { sequelize } = require("../config/database")
const slugify = require('slugify');

const Produto = sequelize.define(
  "Produto",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nome: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    descricao: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    preco: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    // --- MUDANÇA CRÍTICA AQUI ---
    // O valor padrão para colunas JSON no PostgreSQL deve ser uma string.
    imagens: {
      type: DataTypes.JSON,
      defaultValue: '[]', // Alterado de [] para '[]'
    },
    itensDownload: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: '[]', // Alterado de [] para '[]'
    },
    // ----------------------------
    categoriaId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'categorias',
        key: 'id'
      }
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    peso: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
      defaultValue: 0.300, 
    },
     largura: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 10.00,
    },
     altura: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 10.00,
    },
     comprimento: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 10.00,
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "Produto",
    tableName: "produtos",
    timestamps: true,
    underscored: true,
    hooks: {
        beforeCreate: (produto, options) => {
            if (produto.nome && !produto.slug) {
                produto.slug = slugify(produto.nome, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
            }
        },
         beforeUpdate: (produto, options) => {
             if (produto.changed('nome') && !options.fields.includes('slug')) {
                  produto.slug = slugify(produto.nome, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
             } else if (produto.changed('slug') && produto.slug === '') {
                 produto.slug = slugify(produto.nome, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
             }
         }
     }
  },
)

module.exports = Produto