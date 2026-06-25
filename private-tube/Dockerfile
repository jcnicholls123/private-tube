FROM node:24-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV PORT=3020
ENV MEDIA_DIR=/media
ENV DATA_DIR=/data

EXPOSE 3020
CMD ["npm", "start"]
