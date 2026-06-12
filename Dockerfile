FROM mcr.microsoft.com/playwright:v1.44.1-jammy

WORKDIR /app

COPY package*.json ./

# Skip browser downloads since the official Playwright image already has them pre-installed
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
