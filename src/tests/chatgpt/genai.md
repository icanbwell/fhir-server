# Generative AI

## Vector store
Vector stores are used to store text and embedding vectors and the ability to find documents similar to a given text. 
 
We currently support three vector stores:
1. In-memory vector store (for unit testing)
2. OpenSearch vector store (used for local testing)
3. Mongo Atlas vector store (used for production)

## Loading data into the vector store
When a resource is created or updated, the FHIR server initiates an update to the vector store.

The first step is to generate a text document for each FHIR resource.  This is generated 


