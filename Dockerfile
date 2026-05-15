FROM public.ecr.aws/docker/library/node:24.14-alpine AS build
# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ARG NODE_ENV=production

# Enable corepack for Yarn 4
RUN corepack enable

RUN mkdir /srv/src
WORKDIR /srv/src
COPY package.json yarn.lock .yarnrc.yml ./

RUN echo "$NODE_ENV"
RUN if [ "$NODE_ENV" = "development" ] ; then echo 'building development' && yarn install; else echo 'building production' && yarn workspaces focus --production; fi

FROM public.ecr.aws/docker/library/node:24.14-alpine
# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ARG NODE_ENV=production

# Enable corepack for Yarn 4
RUN corepack enable

# Set the working directory
RUN mkdir -p /srv/src && chown node:node /srv/src
WORKDIR /srv/src

# Required for Redis integration
RUN apk add --no-cache ca-certificates
RUN update-ca-certificates

# Copy our package.json & install our dependencies
USER node
COPY --chown=node:node package.json yarn.lock .yarnrc.yml ./
COPY --chown=node:node k8s-start.sh /srv/src/k8s-start.sh

# install yarn
RUN corepack install

# Copy node_modules from build stage
COPY --from=build --chown=node:node /srv/src/node_modules /srv/src/node_modules

# Copy the remaining application code.
COPY --chown=node:node . /srv/src

# this gets replaced by the command in docker-compose
CMD ["tail", "-f", "/dev/null"]
