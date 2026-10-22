FROM node:24-slim
WORKDIR /app
COPY . .
ENV DATA_DIR=/data PORT=10000
VOLUME /data
EXPOSE 10000
CMD ["node", "server.js"]
