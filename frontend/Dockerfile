# syntax=docker/dockerfile:1.7

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
