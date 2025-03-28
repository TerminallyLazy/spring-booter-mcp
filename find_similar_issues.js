this.server.tool('find_similar_issues', z.object({ errorMessage: z.string().min(1, 'Error message is required'), timeRangeHours: z.number().optional(), limit: z.number().optional(), similarityThreshold: z.number().optional() }).shape, async (params) => {
    /**
     * Finds similar issues in the logs database using vector similarity search
     * @param {string} errorMessage - The error message to find similar issues for
     * @param {number} [timeRangeHours=24] - Time range in hours to search for similar issues
     * @param {number} [limit=10] - Maximum number of similar issues to return
     * @param {number} [similarityThreshold=0.7] - Minimum similarity score (0-1) to include in results
     */
    try {
      const errorMessage = params.errorMessage;
      const timeRangeHours = params.timeRangeHours || 24;
      const limit = params.limit || 10;
      const similarityThreshold = params.similarityThreshold || 0.7;
      
      // First, get an embedding for the error message
      const embeddingResponse = await fetch(`${this.env.EMBEDDING_API_URL || 'http://localhost:8080/api/embedding'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.EMBEDDING_API_KEY}`
        },
        body: JSON.stringify({
          text: errorMessage
        })
      });
      
      if (!embeddingResponse.ok) {
        throw new Error(`Failed to generate embedding: ${embeddingResponse.status}`);
      }
      
      const embeddingData = await embeddingResponse.json();
      const embedding = embeddingData.embedding;
      
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding returned from API');
      }
      
      // Now search for similar logs using the embedding
      const searchResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/vector-search'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.DB_API_KEY}`
        },
        body: JSON.stringify({
          embedding: embedding,
          timeRangeHours: timeRangeHours,
          limit: limit,
          similarityThreshold: similarityThreshold,
          includeMetadata: true
        })
      });
      
      if (!searchResponse.ok) {
        throw new Error(`Vector search failed: ${searchResponse.status}`);
      }
      
      const searchResults = await searchResponse.json();
      
      if (!searchResults.results || searchResults.results.length === 0) {
        return {
          content: [{ type: 'text', text: 'No similar issues found in the specified time range.' }]
        };
      }
      
      // Group results by trace ID to show related issues
      const resultsByTrace = {};
      
      searchResults.results.forEach(result => {
        if (result.trace_id) {
          if (!resultsByTrace[result.trace_id]) {
            resultsByTrace[result.trace_id] = [];
          }
          resultsByTrace[result.trace_id].push(result);
        }
      });
      
      // Format the response
      const formattedResults = {
        query: errorMessage,
        timeRange: `${timeRangeHours} hours`,
        totalResults: searchResults.results.length,
        similarIssues: Object.keys(resultsByTrace).map(traceId => {
          const traceResults = resultsByTrace[traceId];
          return {
            traceId: traceId,
            similarityScore: traceResults[0].similarity, // Use the highest similarity score
            timestamp: traceResults[0].log_timestamp,
            service: traceResults[0].service_name,
            message: traceResults[0].message,
            relatedLogCount: traceResults.length
          };
        }).sort((a, b) => b.similarityScore - a.similarityScore) // Sort by similarity
      };
      
      return {
        content: [{ type: 'text', text: JSON.stringify(formattedResults, null, 2) }]
      };
    } catch (error) {
      console.error('Error finding similar issues:', error);
      return {
        content: [{ type: 'text', text: `Error finding similar issues: ${error.message}` }],
        isError: true
      };
    }
  });