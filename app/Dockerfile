# Usar una imagen base de Node.js
FROM node:22-alpine

# Copiar archivos
WORKDIR /app
COPY . .

# Instalar dependencias
RUN npm install

# Exponer el puerto del exporter
EXPOSE 2233

# Comando para ejecutar la aplicación
CMD ["node", "exporter.js"]