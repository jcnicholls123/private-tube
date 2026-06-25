FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV PORT=3020
ENV MEDIA_DIR=/media

EXPOSE 3020
CMD ["npm", "start"]
