# FROM node:18-alpine

# WORKDIR /index

# COPY package*.json package-lock.json ./

# RUN npm install --frozen-lockfile

# COPY . .

# # RUN npx tsc
# RUN npm run build

# EXPOSE 3000

# CMD ["npm", "start"]




# # Use AWS Lambda Node.js base
# FROM public.ecr.aws/lambda/nodejs:20 AS build

# # Install dependencies needed for resvg
# RUN yum install -y gcc gcc-c++ make python3 rust cargo

# # Set working directory
# WORKDIR /var/task

# # Copy package files
# COPY package*.json ./

# # Install only production dependencies
# RUN npm install --production

# # Copy the rest of your code
# COPY . .

# # Build your app (ts → js)
# RUN npm run build

# # Lambda will run dist/index.handler
# CMD ["dist/index.handler"]



# # Use Node.js 18 slim image (Debian-based, smaller than full Debian)
# FROM node:18-slim

# # Install build dependencies required by resvg-js
# RUN apt-get update && apt-get install -y \
#     build-essential \
#     python3 \
#     rustc \
#     cargo \
#     pkg-config \
#     libc6-dev \
#     && rm -rf /var/lib/apt/lists/*

# # Set working directory
# WORKDIR /app

# # Copy package.json and package-lock.json first (for caching)
# COPY package*.json ./

# # Install dependencies
# RUN npm install

# # Copy rest of the app
# COPY . .

# # Build your app (if needed, e.g. TypeScript)
# RUN npm run build

# # Start app
# CMD ["npm", "start"]








# # -------------------
# # Stage 1: Builder
# # -------------------
# FROM public.ecr.aws/lambda/nodejs:20 AS builder

# # Install build tools for Rust + native modules
# RUN dnf install -y gcc gcc-c++ make python3 rust cargo

# # Set workdir
# WORKDIR /usr/app

# # Copy package manifests first (for caching)
# COPY package*.json ./

# # Install dependencies (including @resvg/resvg-js, compiled here)
# RUN npm install --omit=dev

# # Copy the rest of the source
# COPY . .

# # Build (if you have a build step, e.g. tsc / bundler)
# RUN npm run build || echo "No build step"

# # -------------------
# # Stage 2: Runtime
# # -------------------
# FROM public.ecr.aws/lambda/nodejs:20

# # Set workdir
# WORKDIR ${LAMBDA_TASK_ROOT}

# # Copy only built dependencies and dist from builder
# COPY --from=builder /usr/app/node_modules ./node_modules
# COPY --from=builder /usr/app/dist ./dist
# COPY --from=builder /usr/app/package*.json ./

# # If you don’t have /dist, copy your src/index.js directly
# # COPY --from=builder /usr/app/src ./src

# # Lambda entrypoint
# CMD [ "dist/index.handler" ]



# Stage 1: build dependencies
# FROM --platform=linux/arm64 node:20-bullseye AS build
# WORKDIR /app

# # Copy package files first to leverage Docker layer caching
# COPY package*.json ./
# RUN npm ci --production

# # Copy source code
# COPY . .

# # Stage 2: Lambda base image
# FROM public.ecr.aws/lambda/nodejs:20-arm64

# # Copy built app from build stage
# COPY --from=build /app /var/task

# # Set Lambda handler (matches your exports.handler)
# CMD ["dist/app.handler"]


# Stage 1: Build dependencies and app
FROM node:20-bullseye AS build
WORKDIR /app

# Install system dependencies for sharp
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libvips-dev \
 && rm -rf /var/lib/apt/lists/*

# Copy package files and install deps
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build   # if you have TypeScript

# Stage 2: Lambda runtime
FROM public.ecr.aws/lambda/nodejs:20
WORKDIR /var/task

# Copy node_modules and built files from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./

# Set handler
CMD ["dist/index.handler"]
