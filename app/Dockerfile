# Usar una imagen base de Node.js
FROM node:18-alpine

# Copiar archivos
WORKDIR /app
COPY . .

# Instalar dependencias
RUN npm install

#COPY exporter.js .

# Exponer el puerto del exporter
EXPOSE 2233

# Comando para ejecutar la aplicación
CMD ["node", "exporter.js"]