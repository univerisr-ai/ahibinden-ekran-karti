# .github/Dockerfile
FROM mcr.microsoft.com/playwright:v1.59.0-jammy

RUN pip install "playwright<=1.59.0" camoufox --prefer-binary
RUN npx playwright install firefox

WORKDIR /app
COPY scripts/camoufox-server.py /app/
COPY src/ /app/src/
COPY package*.json /app/
RUN npm ci --no-optional --ignore-scripts 2>&1 | tail -3

ENV CAMOUFOX_HEADLESS=true
ENV CAMOUFOX_PROXY=socks5://127.0.0.1:40000
