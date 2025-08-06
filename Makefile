.PHONY:build
build:
	docker buildx build -t imranq2/node-fhir-server-mongo:local .

.PHONY:build_all
build_all:
	docker buildx build --platform=linux/amd64,linux/arm64 -t imranq2/node-fhir-server-mongo:local .

.PHONY:publish
publish:
	docker push imranq2/node-fhir-server-mongo:latest

.PHONY:up
up:
	docker compose -f docker-compose.yml  -p fhir-dev build --parallel && \
	docker compose -p fhir-dev -f docker-compose.yml up --detach && \
	echo "\nwaiting for Mongo server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev-mongo-1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "healthy" ]; then docker ps && docker logs fhir-dev-mongo-1 && printf "========== ERROR: fhir-dev-mongo-1 did not start. Run docker logs fhir-dev-mongo-1 =========\n" && exit 1; fi
	echo "\nwaiting for FHIR server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev-fhir-1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "healthy" ]; then docker ps && docker logs fhir-dev-fhir-1 && printf "========== ERROR: fhir-dev-fhir-1 did not start. Run docker logs fhir-dev-fhir-1 =========\n" && exit 1; fi
	if [ ! -f ./generatorScripts/data/.collections_created ]; then \
		echo "\nCreating all mongo collections and indexes" && \
		make create_all_collections && \
		mkdir -p ./generatorScripts/data && \
		touch ./generatorScripts/data/.collections_created; \
	fi
	echo FHIR server GraphQL: http://localhost:3000/\$$graphql && \
	echo KeyCloak UI: http://localhost:8080 && \
	echo Kafka UI: http://localhost:9000 && \
	echo HAPI UI: http://localhost:3001/fhir/ && \
	echo FHIR server: http://localhost:3000

.PHONY: create_all_collections
create_all_collections:
	docker exec -t fhir-dev-fhir-1 sh -c "cd /srv/src && node src/admin/scripts/createCollections.js"
	echo "\nAll collections and indexes created successfully."

.PHONY:up-offline
up-offline:
	docker compose -p fhir-dev -f docker-compose.yml up --detach && \
	echo "\nwaiting for Mongo server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev-mongo-1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "healthy" ]; then docker ps && docker logs fhir-dev-mongo-1 && printf "========== ERROR: fhir-dev-mongo-1 did not start. Run docker logs fhir-dev-mongo-1 =========\n" && exit 1; fi
	echo "\nwaiting for FHIR server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev-fhir-1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "healthy" ]; then docker ps && docker logs fhir-dev-fhir-1 && printf "========== ERROR: fhir-dev-fhir-1 did not start. Run docker logs fhir-dev-fhir-1 =========\n" && exit 1; fi
	echo FHIR server GraphQL: http://localhost:3000/\$$graphql && \
	echo KeyCloak UI: http://localhost:8080 && \
	echo Kafka UI: http://localhost:9000 && \
	echo HAPI UI: http://localhost:3001/fhir/ && \
	echo FHIR server: http://localhost:3000

.PHONY:up-autoinstrumentation
up-autoinstrumentation:
	docker compose -f docker-compose.yml  -p fhir-dev build --parallel && \
	docker compose -p fhir-dev -f docker-compose.yml -f docker-compose-autoinstrumentation.yml up --detach && \
	echo "\nwaiting for Mongo server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev-mongo-1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-mongo-1`" != "healthy" ]; then docker ps && docker logs fhir-dev-mongo-1 && printf "========== ERROR: fhir-dev-mongo-1 did not start. Run docker logs fhir-dev-mongo-1 =========\n" && exit 1; fi
	echo "\nwaiting for FHIR server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-dev-fhir-1`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-dev-fhir-1`" != "healthy" ]; then docker ps && docker logs fhir-dev-fhir-1 && printf "========== ERROR: fhir-dev-fhir-1 did not start. Run docker logs fhir-dev-fhir-1 =========\n" && exit 1; fi
	echo FHIR server GraphQL: http://localhost:3000/\$$graphql && \
	echo KeyCloak UI: http://localhost:8080 && \
	echo Kafka UI: http://localhost:9000 && \
	echo HAPI UI: http://localhost:3001/fhir/ && \
	echo FHIR server: http://localhost:3000

.PHONY:down
down:
	docker compose -p fhir-dev -f docker-compose.yml -f docker-compose-autoinstrumentation.yml down && \
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
	nvm install
	make update


.PHONY:update
update:down
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm install --location=global yarn && \
	rm -f yarn.lock && \
	yarn install --no-optional

# https://www.npmjs.com/package/npm-check-updates
.PHONY:upgrade_packages
upgrade_packages:down
	. ${NVM_DIR}/nvm.sh && nvm use && \
	yarn install --no-optional && \
	npm install -g npm-check-updates && \
	ncu -u --reject @sentry/node

.PHONY:tests
tests:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test

.PHONY:test_shards
test_shards:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test_shards

.PHONY:coverage
coverage:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run coverage

.PHONY:failed_tests
failed_tests:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test:failed

.PHONY:specific_tests
specific_tests:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test:specific

.PHONY:tests_integration
tests_integration:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test:integration

.PHONY:tests_everything
tests_everything:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test:everything

.PHONY:tests_graphql
tests_graphql:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test:graphql

.PHONY:tests_search
tests_search:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run test:search

.PHONY:lint
lint:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run lint

.PHONY:fix-lint
fix-lint:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm run fix_lint && \
	npm run lint

.PHONY:generate
generate:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/generate_services.py" && \
	eslint --fix "src/profiles.js"

.PHONY:shell
shell: ## Brings up the bash shell in dev docker
	docker compose -p fhir-dev -f docker-compose.yml run --rm --name fhir fhir /bin/sh

.PHONY:clean-pre-commit
clean-pre-commit: ## removes pre-commit hook
	rm -f .git/hooks/pre-commit

.PHONY:setup-pre-commit
setup-pre-commit:
	cp ./pre-commit-hook ./.git/hooks/pre-commit

.PHONY:run-pre-commit
run-pre-commit: setup-pre-commit
	./.git/hooks/pre-commit

.PHONY:graphql
graphql:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/graphql/generate_graphql_classes.py" && \
	graphql-schema-linter src/graphql/**/*.graphql && \
	eslint --fix "src/graphql/**/*.js"

.PHONY:graphqlv2
graphqlv2:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/graphqlv2/generate_graphqlv2_classes.py" && \
	graphql-schema-linter src/graphqlv2/**/*.graphql && \
	eslint --fix "src/graphqlv2/**/*.js"

.PHONY:classes
classes:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/classes/generate_classes.py && python3 generatorScripts/classes/generate_classes_index.py" && \
	eslint --fix "src/fhir/classes/**/*.js"

.PHONY:searchParameters
searchParameters:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/searchParameters/generate_search_parameters.py" && \
	eslint --fix "src/middleware/fhir/resources/**/*.js" && \
	eslint --fix "src/searchParameters/*.js"

.PHONY:fastSerializers
fastSerializers:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/fastSerializers/generate_serializers.py && python3 generatorScripts/fastSerializers/generate_classes_serializer_index.py" && \
	eslint --fix "src/fhir/serializers/4_0_0/**/*.js"

.PHONY:audit_fix
audit_fix:
	. ${NVM_DIR}/nvm.sh && nvm use && \
	npm audit fix

.PHONY:qodana
qodana:
	docker run --rm -it --name qodana --mount type=bind,source="${PWD}",target=/data/project -p 8080:8080 jetbrains/qodana-js:2022.3-eap --show-report

.PHONY:schema
schema:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml && cd app && python3 generatorScripts/generate_schema.py"

.PHONY:everythingOperationData
everythingOperationData:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml && cd app && python3 generatorScripts/generate_everything_operation_data.py"

.PHONY:resourceFieldTypes
resourceFieldTypes:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml && cd app && python3 generatorScripts/generate_resource_fields_type.py"

.PHONY:getResourceReferencedBy
getResourceReferencedBy:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml && cd app && python3 generatorScripts/get_resource_referenced_by.py"

.PHONY:dbSchema
dbSchema:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml && cd app && python3 generatorScripts/db-schema/generate_db_schema.py"

# useful for reflecting env update through docker-compose in fhir for local development
.PHONY:restart_fhir
restart_fhir:
	docker compose -p fhir-dev -f docker-compose.yml down fhir && \
	docker compose -p fhir-dev -f docker-compose.yml up fhir -d --no-deps
