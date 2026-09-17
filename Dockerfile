# Railway / Docker 构建用。Vercel 会自动忽略它，两边互不影响。
# 运行时零依赖，只需要 Node。
FROM node:22-slim

WORKDIR /app

COPY server.mjs ./
COPY api ./api
COPY lib ./lib
COPY sites ./sites

# Railway 会自动注入 PORT，server.mjs 会读它；本地默认 3000
EXPOSE 3000

CMD ["node", "server.mjs"]
