FROM node:20-slim

# Install system utilities needed for playwright setup
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Instruct Playwright to skip browser downloads during npm install
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm ci --only=production && npm cache clean --force

# Install ONLY the Chromium browser and its system dependencies
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
