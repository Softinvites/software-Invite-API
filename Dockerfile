FROM node:18-alpine

WORKDIR /index

COPY package*.json package-lock.json ./

RUN npm install --frozen-lockfile

COPY . .

# RUN npx tsc
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]

