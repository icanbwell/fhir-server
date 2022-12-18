NODE_VERSION=16.18.1

.PHONY:build
build:
	docker buildx build --platform=linux/amd64 -t imranq2/node-fhir-server-mongo:local .

.PHONY:build_all
build_all:
	docker buildx build --platform=linux/amd64,linux/arm64 -t imranq2/node-fhir-server-mongo:local .

.PHONY:publish
publish:
	docker push imranq2/node-fhir-server-mongo:latest

.PHONY:up
up:
	docker-compose -f docker-compose.yml  -p fhir-dev build --parallel && \
	docker-compose -p fhir-dev -f docker-compose.yml up --detach && \
	echo "\nwaiting for Mongo server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_mongo_1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_mongo_1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev_mongo_1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_mongo_1`" != "healthy" ]; then docker ps && docker logs fhir-dev_mongo_1 && printf "========== ERROR: fhir-dev_mongo_1 did not start. Run docker logs fhir-dev_mongo_1 =========\n" && exit 1; fi
	echo "waiting for ElasticSearch server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} elasticsearch`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} elasticsearch`" != "failed" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} elasticsearch`" != "healthy" ]; then printf "ERROR: Container did not start. Run docker logs elasticsearch\n" && exit 1; fi  && \
	echo "\nwaiting for FHIR server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_fhir_1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_fhir_1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev_fhir_1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_fhir_1`" != "healthy" ]; then docker ps && docker logs fhir-dev_fhir_1 && printf "========== ERROR: fhir-dev_mongo_1 did not start. Run docker logs fhir-dev_fhir_1 =========\n" && exit 1; fi
	@echo "\nElastic Search Kibana: http://localhost:5601/ (admin:admin)" && \
	echo "Elastic Search: https://localhost:9200/fhir-logs-*/_search (admin:admin)" && \
	echo FHIR server GraphQL: http://localhost:3000/graphqlv2 && \
	echo FHIR server Metrics: http://localhost:3000/metrics && \
	echo Kafka UI: http://localhost:9000 && \
	echo FHIR server: http://localhost:3000

.PHONY:up-offline
up-offline:
	docker-compose -p fhir-dev -f docker-compose.yml up --detach && \
	echo "waiting for Fhir server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev_fhir_1`" != "healthy" ]; do printf "." && sleep 2; done
	echo FHIR server GraphQL: http://localhost:3000/graphql && \
	echo FHIR server: http://localhost:3000/

.PHONY:down
down:
	docker-compose -p fhir-dev -f docker-compose.yml down && \
	docker system prune -f

.PHONY:clean
clean: down
	docker image rm imranq2/node-fhir-server-mongo -f
	docker image rm node-fhir-server-mongo_fhir -f
	docker volume rm fhir-dev_mongo_data -f
ifneq ($(shell docker volume ls | grep "fhir-dev"| awk '{print $$2}'),)
	docker volume ls | grep "fhir-dev" | awk '{print $$2}' | xargs docker volume rm
endif

.PHONY:init
init:
	brew update  # update brew
	#brew upgrade  # upgrade all installed packages
	brew install yarn
	brew install kompose
	#brew install nvm
	curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.39.1/install.sh | zsh
	nvm install ${NODE_VERSION}
	make update

#   We use gitpkg to expose the subfolder as a package here.
#	When you change the package go here to create a new link: https://gitpkg.vercel.app/ using the path:
# https://github.com/icanbwell/node-fhir-server-core/tree/master/packages/node-fhir-server-core
# 	yarn cache clean && \
#	yarn --update-checksums && \
# 	cd node_modules/@asymmetrik/node-fhir-server-core && yarn install
# "@asymmetrik/node-fhir-server-core": "https://gitpkg.now.sh/icanbwell/node-fhir-server-core/packages/node-fhir-server-core?master",

.PHONY:update
update:down
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm install --location=global yarn && \
	rm -f yarn.lock && \
	yarn install --no-optional && \
	npm i --package-lock-only

.PHONY:tests
tests:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test_shards

.PHONY:coverage
coverage:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run coverage

.PHONY:failed_tests
failed_tests:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test:failed

.PHONY:specific_tests
specific_tests:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test:specific

.PHONY:tests_integration
tests_integration:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test:integration

.PHONY:tests_everything
tests_everything:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test:everything

.PHONY:tests_graphql
tests_graphql:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test:graphql

.PHONY:tests_search
tests_search:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run test:search

.PHONY:lint
lint:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run lint

.PHONY:fix-lint
fix-lint:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm run fix_lint && \
	npm run lint

.PHONY:generate
generate:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/src,target=/src python:3.8-slim-buster sh -c "pip install lxml jinja2 && python3 src/services/generate_services.py"

.PHONY:shell
shell: ## Brings up the bash shell in dev docker
	docker-compose -p fhir-dev -f docker-compose.yml run --rm --name fhir fhir /bin/sh

.PHONY:clean-pre-commit
clean-pre-commit: ## removes pre-commit hook
	rm -f .git/hooks/pre-commit

.PHONY:setup-pre-commit
setup-pre-commit:
	cp ./pre-commit-hook ./.git/hooks/pre-commit

.PHONY:run-pre-commit
run-pre-commit: setup-pre-commit
	./.git/hooks/pre-commit

.PHONY:graphqlv1
graphqlv1:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/src,target=/src python:3.8-slim-buster sh -c "pip install lxml jinja2 && python3 src/graphql/v1/generator/generate_classes.py" && \
	graphql-schema-linter src/graphql/v1/**/*.graphql

.PHONY:graphql
graphql:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/src,target=/src python:3.8-slim-buster sh -c "pip install lxml jinja2 && python3 src/fhir/generator/generate_graphql_classes.py" && \
	graphql-schema-linter src/graphql/v2/**/*.graphql

.PHONY:classes
classes:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/src,target=/src python:3.8-slim-buster sh -c "pip install lxml jinja2 && python3 src/fhir/generator/generate_classes.py" && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/src,target=/src python:3.8-slim-buster sh -c "pip install lxml jinja2 && python3 src/fhir/generator/generate_classes_index.py" && \
	eslint --fix "src/fhir/classes/**/*.js"

.PHONY:searchParameters
searchParameters:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/src,target=/src python:3.8-slim-buster sh -c "pip install lxml jinja2 && python3 src/searchParameters/generate_search_parameters.py"

.PHONY:audit_fix
audit_fix:
	. ${NVM_DIR}/nvm.sh && nvm use ${NODE_VERSION} && \
	npm audit fix
