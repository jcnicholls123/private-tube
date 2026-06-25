FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV PORT=3020
ENV MEDIA_DIR=/media
ENV DATA_DIR=/data

EXPOSE 3020
CMD ["npm", "start"]
