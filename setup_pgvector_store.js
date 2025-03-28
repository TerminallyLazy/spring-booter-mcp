this.server.tool('setup_pgvector_store', z.object({
    dbUrl: z.string().describe('PostgreSQL database URL (e.g., "jdbc:postgresql://localhost:5432/postgres")'),
    dbUsername: z.string().describe('Database username'),
    dbPassword: z.string().describe('Database password'),
    dimensions: z.number().optional().describe('Embedding dimensions (default: 1536)'),
    indexType: z.enum(['NONE', 'HNSW', 'IVFFlat']).optional().describe('Index type for vector search (default: HNSW)'),
    distanceType: z.enum(['COSINE_DISTANCE', 'EUCLIDEAN_DISTANCE', 'NEGATIVE_INNER_PRODUCT']).optional().describe('Distance metric for similarity search (default: COSINE_DISTANCE)'),
    initializeSchema: z.boolean().optional().describe('Whether to initialize the required schema (default: true)')
  }).shape, async (params) => {
    /** Set up a PGVector store for storing and retrieving embeddings */
    try {
      const {
        dbUrl,
        dbUsername,
        dbPassword,
        dimensions = 1536,
        indexType = 'HNSW',
        distanceType = 'COSINE_DISTANCE',
        initializeSchema = true
      } = params;
      
      // Generate a Spring Boot application.yml configuration
      const configYaml = `spring:
    datasource:
      url: ${dbUrl}
      username: ${dbUsername}
      password: ${dbPassword}
    ai:
      vectorstore:
        pgvector:
          index-type: ${indexType}
          distance-type: ${distanceType}
          dimensions: ${dimensions}
          initialize-schema: ${initializeSchema}
          schema-validation: true`;
      
      // Generate SQL for manual setup
      const sqlSetup = `-- Run these commands manually if not using auto-initialization:
  
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS hstore;
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  
  CREATE TABLE IF NOT EXISTS vector_store (
      id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      content text,
      metadata json,
      embedding vector(${dimensions})
  );
  
  -- Create index based on selected type
  ${indexType === 'HNSW' ? 
    `CREATE INDEX ON vector_store USING HNSW (embedding ${distanceType === 'COSINE_DISTANCE' ? 'vector_cosine_ops' : 
      distanceType === 'EUCLIDEAN_DISTANCE' ? 'vector_l2_ops' : 'vector_ip_ops'});` : 
    indexType === 'IVFFlat' ? 
    `CREATE INDEX ON vector_store USING ivfflat (embedding ${distanceType === 'COSINE_DISTANCE' ? 'vector_cosine_ops' : 
      distanceType === 'EUCLIDEAN_DISTANCE' ? 'vector_l2_ops' : 'vector_ip_ops'});` : 
    '-- No index selected'}`;
      
      // Generate Java/Spring Boot code example
      const javaExample = `// Spring Boot configuration example:
  
  @Bean
  public VectorStore vectorStore(JdbcTemplate jdbcTemplate, EmbeddingModel embeddingModel) {
      return PgVectorStore.builder(jdbcTemplate, embeddingModel)
          .dimensions(${dimensions})
          .distanceType(${distanceType})
          .indexType(${indexType})
          .initializeSchema(${initializeSchema})
          .schemaName("public")
          .vectorTableName("vector_store")
          .build();
  }
  
  // Usage example:
  
  @Autowired VectorStore vectorStore;
  
  // Add documents
  List<Document> documents = List.of(
      new Document("Document content 1", Map.of("key1", "value1")),
      new Document("Document content 2", Map.of("key2", "value2"))
  );
  vectorStore.add(documents);
  
  // Search for similar documents
  List<Document> results = vectorStore.similaritySearch(
      SearchRequest.builder()
          .query("search query")
          .topK(5)
          .build()
  );
  `;
      
      // Generate Docker command for local testing
      const dockerCommand = `# Run PGVector locally with Docker:
  docker run -it --rm --name postgres -p 5432:5432 -e POSTGRES_USER=${dbUsername} -e POSTGRES_PASSWORD=${dbPassword} pgvector/pgvector`;
      
      return {
        content: [{ 
          type: 'text', 
          text: `PGVector Store Configuration\n\n` +
                `Spring Boot Configuration (application.yml):\n\n\`\`\`yaml\n${configYaml}\n\`\`\`\n\n` +
                `SQL Setup (if manual initialization):\n\n\`\`\`sql\n${sqlSetup}\n\`\`\`\n\n` +
                `Java Example:\n\n\`\`\`java\n${javaExample}\n\`\`\`\n\n` +
                `Docker Command (for local testing):\n\n\`\`\`bash\n${dockerCommand}\n\`\`\``
        }]
      };
    } catch (error) {
      console.error('Error in setup_pgvector_store tool:', error);
      return {
        content: [{ type: 'text', text: `Error setting up PGVector store: ${error.message}` }],
        isError: true
      };
    }
  });