FROM node:20-slim

LABEL org.opencontainers.image.title="bcsmcp" \
      org.opencontainers.image.description="BCS-MCP unified image (server + worker)" \
      org.opencontainers.image.source="https://github.com/plagness/BCS-MCP.git" \
      ns.module="bcs" \
      ns.component="mcp"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     python3 python3-pip python3-venv dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY server/package.json server/package-lock.json* server/
RUN cd server && npm install

# Python deps (PEP 668: allow system install inside container)
COPY worker/requirements.txt worker/
RUN pip3 install --no-cache-dir --break-system-packages -r worker/requirements.txt

# App sources
COPY server server
COPY worker worker
COPY scripts scripts
COPY db db
COPY bin bin

RUN chmod +x /app/bin/entrypoint.sh \
  && cd server && npm run build

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/app/bin/entrypoint.sh"]
