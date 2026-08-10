FROM node:20.19.6-alpine AS build
WORKDIR /workspace
COPY package.json ./
COPY package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY backend/tsconfig.json backend/tsconfig.json
RUN npm ci --workspace backend --ignore-scripts
COPY backend/src backend/src
COPY backend/migrations backend/migrations
RUN npm run build --workspace backend

FROM node:20.19.6-alpine
RUN apk add --no-cache git ca-certificates
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/backend/package.json ./package.json
COPY --from=build /workspace/backend/dist ./dist
COPY --from=build /workspace/backend/migrations ./migrations
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
