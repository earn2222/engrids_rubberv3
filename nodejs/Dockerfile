FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install -g nodemon && npm install
COPY . .
EXPOSE 3000