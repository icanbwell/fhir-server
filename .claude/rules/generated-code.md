---
paths:
  - "src/services/**"
  - "src/searchParameters/**"
  - "src/graphql/**"
  - "src/graphqlv2/**"
  - "generated.sdl/**"
---

# Generated code

These files are produced by `generatorScripts/`. Do not hand-edit them: change the generator or its
inputs, then regenerate with `make generate` (or `make graphql`,
`make searchParameters`) and commit the regenerated output. After GraphQL changes also run
`make graphql-sdl` to rebuild `generated.sdl/` (`make check-graphql-sdl` verifies it).
