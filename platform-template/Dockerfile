FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
RUN npx playwright install --with-deps chromium
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
