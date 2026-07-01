FROM node:20-alpine

# Runtime tools for Broadcast Engine / YouTube streaming.
# ffmpeg = encoder/RTMP sender
# chromium + xvfb = render the RGE HTML output without OBS or a desktop session
# fonts = prevent missing glyphs in graphics output
RUN apk add --no-cache \
    bash \
    ffmpeg \
    chromium \
    xvfb \
    ttf-freefont \
    font-noto \
    mesa-dri-gallium

ENV CHROME_BIN=/usr/bin/chromium-browser
ENV FFMPEG_PATH=/usr/bin/ffmpeg

WORKDIR /app

# Copy only package.json first, so dependency install is cached cleanly.
# Do not use the old package-lock.json from previous builds.
COPY package.json ./

# Force public npm registry and fail the build if Express is not installed properly.
RUN npm config set registry https://registry.npmjs.org/ \
    && npm cache clean --force \
    && npm install --omit=dev \
    && test -f node_modules/express/package.json

COPY src ./src
COPY public ./public
COPY README.md ./README.md
COPY scripts ./scripts
RUN chmod +x /app/scripts/*.sh || true

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
