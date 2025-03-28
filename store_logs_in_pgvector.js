this.server.tool('store_logs_in_pgvector', z.object({
    processedLogPath: z.string().describe('Path to the processed log data JSON file'),
    dbConfig: z.object({
      url: z.string().describe('PostgreSQL database URL (e.g., "jdbc:postgresql://localhost:5432/postgres")'),
      username: z.string().describe('Database username'),
      password: z.string().describe('Database password'),
      schema: z.string().optional().describe('Database schema (default: "public")'),
      tableName: z.string().optional().describe('Vector store table name (default: "vector_store")')
    }).describe('Database configuration'),
    embeddingConfig: z.object({
      modelName: z.string().optional().describe('Embedding model name (default: "all-MiniLM-L6-v2")'),
      batchSize: z.number().optional().describe('Batch size for embedding generation (default: 32)'),
      dimensions: z.number().optional().describe('Embedding dimensions (default: 384 for all-MiniLM-L6-v2)')
    }).optional().describe('Embedding configuration'),
    indexType: z.enum(['NONE', 'HNSW', 'IVFFlat']).optional().describe('Index type for vector search (default: HNSW)')
  }).shape, async (params) => {
    /** Store processed log data in PGVector for efficient retrieval and similarity search */
    try {
      const {
        processedLogPath,
        dbConfig,
        embeddingConfig = {
          modelName: 'all-MiniLM-L6-v2',
          batchSize: 32,
          dimensions: 384
        },
        indexType = 'HNSW'
      } = params;
      
      const schema = dbConfig.schema || 'public';
      const tableName = dbConfig.tableName || 'vector_store';
      const modelName = embeddingConfig.modelName || 'all-MiniLM-L6-v2';
      const batchSize = embeddingConfig.batchSize || 32;
      const dimensions = embeddingConfig.dimensions || 384;
      
      const script = `
  import json
  import os
  import psycopg2
  import numpy as np
  from sentence_transformers import SentenceTransformer
  from psycopg2.extras import Json
  from tqdm import tqdm
  
  try:
      # Load processed log data
      with open(${JSON.stringify(processedLogPath)}, 'r', encoding='utf-8') as f:
          logs = json.load(f)
      
      # Connect to PostgreSQL
      conn = psycopg2.connect(
          host=${JSON.stringify(dbConfig.url.split('//')[1].split(':')[0])},
          port=${JSON.stringify(dbConfig.url.split(':')[2].split('/')[0])},
          database=${JSON.stringify(dbConfig.url.split('/')[3])},
          user=${JSON.stringify(dbConfig.username)},
          password=${JSON.stringify(dbConfig.password)}
      )
      
      cursor = conn.cursor()
      
      # Create extensions if they don't exist
      cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
      cursor.execute("CREATE EXTENSION IF NOT EXISTS hstore;")
      cursor.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";")
      
      # Create schema if it doesn't exist
      cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {${JSON.stringify(schema)}};")
      
      # Create vector_store table if it doesn't exist
      cursor.execute(f"""
      CREATE TABLE IF NOT EXISTS {${JSON.stringify(schema)}}.{${JSON.stringify(tableName)}} (
          id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
          content text,
          metadata jsonb,
          embedding vector({${dimensions}})
      );
      """)
      
      # Create index based on selected type
      if ${JSON.stringify(indexType)} == "HNSW":
          cursor.execute(f"""
          CREATE INDEX IF NOT EXISTS {${JSON.stringify(tableName)}}_embedding_idx 
          ON {${JSON.stringify(schema)}}.{${JSON.stringify(tableName)}} 
          USING hnsw (embedding vector_cosine_ops);
          """)
      elif ${JSON.stringify(indexType)} == "IVFFlat":
          cursor.execute(f"""
          CREATE INDEX IF NOT EXISTS {${JSON.stringify(tableName)}}_embedding_idx 
          ON {${JSON.stringify(schema)}}.{${JSON.stringify(tableName)}} 
          USING ivfflat (embedding vector_cosine_ops);
          """)
      
      # Load embedding model
      model = SentenceTransformer(${JSON.stringify(modelName)})
      
      # Prepare log data for embedding
      log_texts = []
      log_metadata = []
      
      for log in logs:
          # Extract message or full log content
          if isinstance(log, dict) and "message" in log:
              # This is a raw log format
              message = log["message"]
              metadata = {k: v for k, v in log.items() if k != "message"}
          else:
              # This might be a processed log with original_log
              original_log = log.get("original_log", {})
              message = original_log.get("message", "")
              
              # Create metadata from original log and features
              metadata = {k: v for k, v in original_log.items() if k != "message"}
              
              # Add any extracted features
              if "features" in log:
                  metadata["features"] = log["features"]
              
              # Add label if available
              if "label" in log:
                  metadata["label"] = log["label"]
          
          # Skip empty messages
          if not message or not isinstance(message, str):
              continue
              
          log_texts.append(message)
          log_metadata.append(metadata)
      
      # Generate embeddings in batches
      embeddings = []
      total_batches = (len(log_texts) + ${batchSize} - 1) // ${batchSize}
      
      for i in range(total_batches):
          start_idx = i * ${batchSize}
          end_idx = min((i + 1) * ${batchSize}, len(log_texts))
          batch_texts = log_texts[start_idx:end_idx]
          
          # Generate embeddings for batch
          batch_embeddings = model.encode(batch_texts)
          embeddings.extend(batch_embeddings)
      
      # Insert logs with embeddings into PGVector
      insert_query = f"""
      INSERT INTO {${JSON.stringify(schema)}}.{${JSON.stringify(tableName)}} (content, metadata, embedding)
      VALUES (%s, %s, %s);
      """
      
      inserted_count = 0
      for i in range(len(log_texts)):
          try:
              # Convert embedding to list for storage
              embedding_list = embeddings[i].tolist()
              
              # Insert into database
              cursor.execute(insert_query, (log_texts[i], Json(log_metadata[i]), embedding_list))
              inserted_count += 1
              
              # Commit every 100 records to avoid large transactions
              if inserted_count % 100 == 0:
                  conn.commit()
          except Exception as e:
              print(f"Error inserting log {i}: {str(e)}")
      
      # Final commit
      conn.commit()
      
      # Close connection
      cursor.close()
      conn.close()
      
      # Generate summary
      summary = {
          "total_logs": len(logs),
          "logs_with_embeddings": len(log_texts),
          "inserted_logs": inserted_count,
          "embedding_model": ${JSON.stringify(modelName)},
          "embedding_dimensions": ${dimensions},
          "db_schema": ${JSON.stringify(schema)},
          "db_table": ${JSON.stringify(tableName)},
          "index_type": ${JSON.stringify(indexType)}
      }
      
      print(json.dumps(summary))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error storing logs in PGVector: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Successfully stored logs in PGVector:\n\n`;
        responseText += `- Total logs processed: ${result.total_logs}\n`;
        responseText += `- Logs with embeddings: ${result.logs_with_embeddings}\n`;
        responseText += `- Logs inserted into database: ${result.inserted_logs}\n\n`;
        
        responseText += `Database Configuration:\n`;
        responseText += `- Schema: ${result.db_schema}\n`;
        responseText += `- Table: ${result.db_table}\n`;
        responseText += `- Index Type: ${result.index_type}\n\n`;
        
        responseText += `Embedding Configuration:\n`;
        responseText += `- Model: ${result.embedding_model}\n`;
        responseText += `- Dimensions: ${result.embedding_dimensions}\n\n`;
        
        responseText += `You can now use PGVector for similarity search and retrieval of log entries.`;
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing PGVector storage results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in store_logs_in_pgvector tool:', error);
      return {
        content: [{ type: 'text', text: `Error storing logs in PGVector: ${error.message}` }],
        isError: true
      };
    }
  });