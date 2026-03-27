FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY index.js .

EXPOSE 8080

USER node

CMD ["node", "index.js"]
