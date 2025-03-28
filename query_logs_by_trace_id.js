this.server.tool('query_logs_by_trace_id', z.object({ traceId: z.string().min(1, 'Trace ID is required'), timeRangeMinutes: z.number().optional(), limit: z.number().optional() }).shape, async (params) => {
    /**
     * Retrieves all logs associated with a specific trace ID from the PGVector database
     * @param {string} traceId - The trace ID to search for
     * @param {number} [timeRangeMinutes=60] - Time range in minutes to limit the search
     * @param {number} [limit=100] - Maximum number of logs to return
     */
    try {
      const traceId = params.traceId;
      const timeRangeMinutes = params.timeRangeMinutes || 60;
      const limit = params.limit || 100;
      
      // Construct the database query
      const query = {
        url: this.env.DB_API_URL || 'http://localhost:8080/api/logs/query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.DB_API_KEY}`
        },
        body: JSON.stringify({
          traceId: traceId,
          timeRangeMinutes: timeRangeMinutes,
          limit: limit,
          orderBy: 'log_timestamp',
          orderDirection: 'ASC'
        })
      };
      
      // Execute the query against the database API
      const response = await fetch(query.url, query);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Database query failed: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      
      // Format the logs for display
      const formattedLogs = data.logs.map(log => {
        return {
          timestamp: log.log_timestamp,
          service: log.service_name,
          level: log.log_level,
          spanId: log.span_id || 'N/A',
          message: log.message,
          metadata: log.metadata || {}
        };
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            traceId: traceId,
            totalLogs: formattedLogs.length,
            timeRange: `${timeRangeMinutes} minutes`,
            logs: formattedLogs
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error querying logs by trace ID:', error);
      return {
        content: [{ type: 'text', text: `Error querying logs: ${error.message}` }],
        isError: true
      };
    }
  });