FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
RUN chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "src/index.js"]
