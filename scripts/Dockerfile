FROM node:18-alpine

RUN apk add --no-cache curl bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN chmod +x wait-and-setup.sh

USER node

CMD ["./wait-and-setup.sh"]
