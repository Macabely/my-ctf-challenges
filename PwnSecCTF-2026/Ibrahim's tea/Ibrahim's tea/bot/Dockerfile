FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

COPY package.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --omit=dev puppeteer@latest && npm cache clean --force

COPY --chown=pptruser:pptruser server.js ./server.js

USER pptruser
CMD ["node", "server.js"]
