FROM node:20-bookworm-slim

WORKDIR /app

# 先拷贝依赖清单，充分利用 Docker 层缓存
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/frontend/package.json packages/frontend/

RUN npm install

# 拷贝全部源码并依次构建：core -> frontend -> server
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Server 同时托管前端构建产物，单容器即可使用
CMD ["node", "packages/server/dist/index.js"]
