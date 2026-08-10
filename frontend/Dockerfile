FROM node:20.19.6-alpine AS deps
WORKDIR /workspace
COPY package.json ./
COPY package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --workspace frontend --ignore-scripts

FROM node:20.19.6-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json ./
COPY package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY frontend ./frontend
RUN npm run build --workspace frontend

FROM node:20.19.6-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/frontend/.next/standalone ./
COPY --from=build /workspace/frontend/.next/static ./frontend/.next/static
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
