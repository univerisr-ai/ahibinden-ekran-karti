# .github/Dockerfile
FROM mcr.microsoft.com/playwright:v1.59.0-jammy

# Install WARP
RUN apt-get update && apt-get install -y curl gnupg2 lsb-release \
    && curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflare-client.list \
    && apt-get update && apt-get install -y cloudflare-warp \
    && rm -rf /var/lib/apt/lists/*

# Python deps
RUN pip install "playwright<=1.59.0" camoufox --prefer-binary

# Playwright Firefox binary
RUN npx playwright install firefox

WORKDIR /app
COPY scripts/camoufox-server.py /app/
COPY src/ /app/src/
COPY package*.json /app/
RUN npm ci --no-optional --ignore-scripts 2>&1 | tail -3

ENV CAMOUFOX_HEADLESS=true
ENV CAMOUFOX_PROXY=socks5://127.0.0.1:40000
