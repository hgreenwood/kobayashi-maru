# Zero-dependency Node app — no npm install needed.
FROM node:20-alpine

WORKDIR /app

# Copy only what the server needs.
COPY package.json ./
COPY server.js ./
COPY public ./public

# Persist config/scores here. In production, mount a persistent volume at
# /data (e.g. a Railway Volume or Render disk) so data survives restarts.
# NOTE: no Docker `VOLUME` instruction — Railway rejects it and manages
# persistence itself via its Volumes feature mounted at this same path.
ENV DATA_DIR=/data

# Hosts inject PORT; default to 3000 for local `docker run`.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
