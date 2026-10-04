FROM node:alpine

WORKDIR /app
COPY --chown=node:node server.js ./server.js

USER node
CMD ["node", "server.js"]
