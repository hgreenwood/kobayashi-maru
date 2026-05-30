# Zero-dependency Node app — no npm install needed.
FROM node:20-alpine

WORKDIR /app

# Copy only what the server needs.
COPY package.json ./
COPY server.js ./
COPY public ./public

# Persist config/scores here; mount a volume at /data in production.
ENV DATA_DIR=/data
VOLUME /data

# Hosts inject PORT; default to 3000 for local `docker run`.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
