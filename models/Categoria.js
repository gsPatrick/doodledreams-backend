const { DataTypes } = require("sequelize")
const { sequelize } = require("../config/database")
const slugify = require('slugify')

const Categoria = sequelize.define(
  "Categoria",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nome: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    descricao: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ativo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
     imagemUrl: { // <<< NOVO CAMPO
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "categorias",
    timestamps: true,
    hooks: {
      beforeValidate: (categoria, options) => {
        if (categoria.nome) {
          categoria.slug = slugify(categoria.nome, { lower: true, strict: true })
        }
      },
    }
  },
)

module.exports = Categoria
