# hc-web-lit, self-contained: it serves itself and holds what a household
# authored. Nothing is built at runtime — Node runs the server's TypeScript by
# stripping types, so there is no build step for it and no toolchain in the
# final image.
FROM docker.io/library/node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM docker.io/library/node:24-alpine
WORKDIR /app
# The built app and the server. No node_modules: the server uses only what is
# in Node itself, which is what keeps this image small and its surface narrow.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

# Where a household's content lives. Mount a volume here and it is as small or
# as large as the end user decides.
ENV HC_CONTENT_DIR=/var/lib/hc-web-lit
ENV HC_WEB_DIR=/app/dist
ENV HC_PORT=8090
# Where core is. This server keeps no users of its own: it asks core who a
# bearer belongs to and what that role may do, because the household already
# has one identity system and two would eventually disagree.
ENV HC_CORE_URL=http://homecore:8080
VOLUME /var/lib/hc-web-lit
EXPOSE 8090

# Not root: this process writes files that a person authored and reads nothing
# else, so it has no business owning them.
USER node
CMD ["node", "server/server.ts"]
