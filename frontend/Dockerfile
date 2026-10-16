# Clairvoyance web app (Next.js). Build context: ./frontend
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The browser only talks to this server; /backend/* is proxied to the API.
# Next resolves rewrites at BUILD time, so BACKEND_URL must be provided when building
# (on Railway: BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:3001).
ARG BACKEND_URL
ARG NEXT_PUBLIC_API_URL=/backend
ENV BACKEND_URL=$BACKEND_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN test -n "$BACKEND_URL" || (echo "BACKEND_URL build variable is required" && exit 1)
RUN npm run build

ENV NODE_ENV=production
# `next start` listens on $PORT (Railway sets it) and defaults to 3000.
EXPOSE 3000
CMD ["npm", "start"]
