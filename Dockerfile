FROM node:18.17.1-bookworm-slim as build
# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ARG NODE_ENV=production

# Update everything on the OS
RUN apt-get -y update && apt-get -y --no-install-recommends install autoconf build-essential && apt-get clean

# update npm
RUN npm install -g npm@9.8.1 && npm upgrade --global yarn
# RUN npm install -g npm@latest && npm upgrade --global yarn && yarn set version berry

RUN mkdir /srv/src
COPY package.json /srv/src/package.json
COPY yarn.lock /srv/src/yarn.lock

RUN echo "$NODE_ENV"
RUN if [ "$NODE_ENV" = "development" ] ; then echo 'building development' && cd /srv/src && yarn install --no-optional; else echo 'building production' && cd /srv/src && yarn cache clean && yarn config delete proxy && yarn config delete https-proxy && yarn config delete registry && yarn install --no-optional --production=true --network-timeout 1000000; fi

FROM node:18.17.1-bookworm-slim as build_react
# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ARG NODE_ENV=production

# Update everything on the OS
RUN apt-get -y update && apt-get -y --no-install-recommends install autoconf build-essential && apt-get clean

# update npm
RUN npm install -g npm@9.8.1 && npm upgrade --global yarn
# RUN npm install -g npm@latest && npm upgrade --global yarn && yarn set version berry

RUN mkdir -p /srv/src/src/web
COPY src/web /srv/src/src/web
RUN if [ "$NODE_ENV" = "development" ] ; then echo 'building development' && cd /srv/src/src/web && yarn install --no-optional; else echo 'building production' && cd /srv/src/src/web && yarn cache clean && yarn config delete proxy && yarn config delete https-proxy && yarn config delete registry && yarn install --no-optional --production=true --network-timeout 1000000; fi
RUN cd /srv/src/src/web && npm run build


FROM node:18.17.1-bookworm-slim
# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ARG NODE_ENV=production

# Update everything on the OS
RUN apt-get -y update && apt-get -y upgrade && apt-get -y --no-install-recommends install curl && apt-get clean

# update npm
RUN npm install -g npm@9.8.1 && npm upgrade --global yarn

# Set the working directory
RUN mkdir -p /srv/src && chown node:node /srv/src
WORKDIR /srv/src

#RUN apt-get -y install gcc

# Copy our package.json & install our dependencies
USER node
COPY --chown=node:node package.json /srv/src/package.json
COPY --chown=node:node yarn.lock /srv/src/yarn.lock

# Copy the remaining application code.
COPY --chown=node:node . /srv/src

# Copy code from multi-stage build above
COPY --from=build /srv/src/node_modules /srv/src/node_modules
COPY --from=build_react /srv/src/src/web/build /srv/src/src/web/build
#COPY --from=build /srv/src/rds-combined-ca-bundle.pem /srv/src/rds-combined-ca-bundle.pem

# this gets replaced by the command in docker-compose
CMD ["tail", "-f", "/dev/null"]

