# Multi-stage build for {{DEPLOYMENT_NAME}} DML Micro App

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy frontend package files
COPY package.json package-lock.json* ./
RUN npm install

# Copy frontend source
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Setup the backend runtime
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Copy all package files (dependencies are now in root)
COPY package.json package-lock.json* ./
RUN npm install --production

# Stage 3: Final runtime image
FROM node:20-alpine

WORKDIR /app

# Install production dependencies
RUN apk add --no-cache \
    tini \
    dumb-init

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/dist ./dist

# Copy node_modules from backend builder
COPY --from=backend-builder /app/node_modules ./node_modules

# Copy server files
COPY server ./server

# Copy package.json (needed for some imports)
COPY package.json ./

# Copy DML file
COPY src/dml ./src/dml

# Set up environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose both frontend and backend ports
# Frontend will be served by a simple static server or reverse proxy
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use tini as init system to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Start the server
CMD ["node", "server/index.js"]
