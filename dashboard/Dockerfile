FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
ENV PORT=4173
EXPOSE 4173
CMD ["sh", "-c", "npx vite preview --host 0.0.0.0 --port ${PORT:-4173}"]
