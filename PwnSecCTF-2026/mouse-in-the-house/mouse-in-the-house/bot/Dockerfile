FROM node:latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system pptruser \
  && useradd --system --gid pptruser --groups audio,video --create-home pptruser \
  && mkdir -p /home/pptruser/Downloads \
  && chown -R pptruser:pptruser /home/pptruser

WORKDIR /bot
COPY package.json package-lock.json* ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --omit=dev
COPY . .

USER pptruser
ENV PORT=3001
EXPOSE 3001
CMD ["node", "bot.js"]
