ACTIVATE_NODE = . ${NVM_DIR}/nvm.sh && nvm use && corepack enable

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
	echo "\nwaiting for ClickHouse server to become healthy" && \
	while [ "`docker inspect --format {{.State.Health.Status}} fhir-clickhouse`" != "healthy" ] && [ "`docker inspect --format {{.State.Health.Status}} fhir-clickhouse`" != "unhealthy" ] && [ "`docker inspect --format {{.State.Status}} fhir-clickhouse`" != "restarting" ]; do printf "." && sleep 2; done && \
	if [ "`docker inspect --format {{.State.Health.Status}} fhir-clickhouse`" != "healthy" ]; then docker ps && docker logs fhir-clickhouse && printf "========== ERROR: fhir-clickhouse did not start. Run docker logs fhir-clickhouse =========\n" && exit 1; fi && \
	echo "\nInitializing ClickHouse schema" && \
	for f in clickhouse-init/*.sql; do docker exec -i fhir-clickhouse clickhouse-client --multiquery < "$$f" || exit 1; done && \
	echo "ClickHouse schema initialized successfully"
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
	echo FHIR server: http://localhost:3000 && \
	echo ClickHouse HTTP: http://localhost:8123

.PHONY: create_all_collections
create_all_collections:
	docker exec -t fhir-dev-fhir-1 sh -c "cd /srv/src && yarn node src/admin/scripts/createCollections.js"
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
	echo FHIR server: http://localhost:3000 && \
	echo ClickHouse HTTP: http://localhost:8123

.PHONY:down
down:
	docker compose -p fhir-dev -f docker-compose.yml down --remove-orphans && \
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
	brew install kompose
	#brew install nvm
	curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.39.1/install.sh | zsh
	nvm install
	corepack enable
	make update


.PHONY:update
update:down
	$(ACTIVATE_NODE) && \
	yarn install

# https://www.npmjs.com/package/npm-check-updates
.PHONY:upgrade_packages
upgrade_packages:down
	$(ACTIVATE_NODE) && \
	yarn install && \
	yarn dlx npm-check-updates -u --reject @sentry/node

.PHONY:tests
tests:
	$(ACTIVATE_NODE) && \
	yarn run test

.PHONY:test_shards
test_shards:
	$(ACTIVATE_NODE) && \
	yarn run test_shards

.PHONY:coverage
coverage:
	$(ACTIVATE_NODE) && \
	yarn run coverage

.PHONY:failed_tests
failed_tests:
	$(ACTIVATE_NODE) && \
	yarn run test:failed

.PHONY:specific_tests
specific_tests:
	$(ACTIVATE_NODE) && \
	yarn run test:specific

.PHONY:tests_integration
tests_integration:
	$(ACTIVATE_NODE) && \
	yarn run test:integration

.PHONY:tests_everything
tests_everything:
	$(ACTIVATE_NODE) && \
	yarn run test:everything

.PHONY:tests_graphql
tests_graphql:
	$(ACTIVATE_NODE) && \
	yarn run test:graphql

.PHONY:tests_search
tests_search:
	$(ACTIVATE_NODE) && \
	yarn run test:search

.PHONY:lint
lint:
	$(ACTIVATE_NODE) && \
	yarn run lint

.PHONY:fix-lint
fix-lint:
	$(ACTIVATE_NODE) && \
	yarn run fix_lint && \
	yarn run lint

.PHONY:generate
generate:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/generate_services.py" && \
	yarn eslint --fix "src/profiles.js"

.PHONY:shell
shell: ## Brings up the bash shell in dev docker
	docker compose -p fhir-dev -f docker-compose.yml run --rm --name fhir fhir /bin/sh

.PHONY:clean-pre-commit
clean-pre-commit: ## removes pre-commit hook
	rm -f .git/hooks/pre-commit

.PHONY:setup-pre-commit
setup-pre-commit:
	printf '#!/bin/bash\nyarn run lint\n' > .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit

.PHONY:run-pre-commit
run-pre-commit: setup-pre-commit
	./.git/hooks/pre-commit

.PHONY:graphql
graphql:
	$(ACTIVATE_NODE) && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/graphql/generate_graphql_classes.py" && \
	yarn graphql-schema-linter src/graphql/**/*.graphql && \
	yarn eslint --fix "src/graphql/**/*.js"

.PHONY:graphqlv2
graphqlv2:
	$(ACTIVATE_NODE) && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/graphqlv2/generate_graphqlv2_classes.py" && \
	yarn graphql-schema-linter src/graphqlv2/**/*.graphql && \
	yarn eslint --fix "src/graphqlv2/**/*.js"

.PHONY:graphql-sdl
graphql-sdl:
	$(ACTIVATE_NODE) && \
	yarn node generatorScripts/generateGraphqlSdl.js

.PHONY:check-graphql-sdl
check-graphql-sdl:
	$(ACTIVATE_NODE) && \
	yarn node generatorScripts/generateGraphqlSdl.js --check

.PHONY:classes
classes:
	$(ACTIVATE_NODE) && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/classes/generate_classes.py && python3 generatorScripts/classes/generate_classes_index.py" && \
	yarn eslint --fix "src/fhir/classes/**/*.js"

.PHONY:searchParameters
searchParameters:
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/searchParameters/generate_search_parameters.py" && \
	yarn eslint --fix "src/middleware/fhir/resources/**/*.js" && \
	yarn eslint --fix "src/searchParameters/*.js"

.PHONY:fastSerializers
fastSerializers:
	$(ACTIVATE_NODE) && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/fastSerializers/generate_serializers.py && python3 generatorScripts/fastSerializers/generate_classes_serializer_index.py" && \
	yarn eslint --fix "src/fhir/serializers/4_0_0/**/*.js"

.PHONY:attachmentFields
attachmentFields:
	$(ACTIVATE_NODE) && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/generate_attachment_fields.py"

.PHONY:serializers
serializers:
	$(ACTIVATE_NODE) && \
	docker run --rm -it --name pythongenerator --mount type=bind,source="${PWD}"/,target=/app python:3.12-alpine sh -c "pip install lxml jinja2 && cd app && python3 generatorScripts/serializers/generate_fast_serializers.py" && \
	yarn eslint --fix "src/fhir/writeSerializers/4_0_0/**/*.js"

.PHONY:audit
audit:
	$(ACTIVATE_NODE) && \
	yarn npm audit

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
	docker compose -p fhir-dev -f docker-compose.yml up fhir -d --no-deps && \
	docker logs -f fhir-dev-fhir-1 2>&1 | jq -RCc '. as $$line | try fromjson catch $$line'

.PHONY:fhir_logs
fhir_logs:
	docker logs -f fhir-dev-fhir-1 2>&1 | jq -RCc '. as $$line | try fromjson catch $$line'
