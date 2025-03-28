this.server.tool('analyze_trace', z.object({ traceId: z.string().min(1, 'Trace ID is required'), timeRangeMinutes: z.number().optional(), detailLevel: z.enum(['basic', 'detailed', 'expert']).optional() }).shape, async (params) => {
    /**
     * Analyzes logs associated with a trace ID to identify issues and provide a summary
     * @param {string} traceId - The trace ID to analyze
     * @param {number} [timeRangeMinutes=60] - Time range in minutes to limit the search
     * @param {string} [detailLevel='detailed'] - Level of detail in the analysis
     */
    try {
      const traceId = params.traceId;
      const timeRangeMinutes = params.timeRangeMinutes || 60;
      const detailLevel = params.detailLevel || 'detailed';
      
      // First, retrieve the logs for this trace ID
      const logsResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/query'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.DB_API_KEY}`
        },
        body: JSON.stringify({
          traceId: traceId,
          timeRangeMinutes: timeRangeMinutes,
          limit: 500, // Get more logs for analysis
          orderBy: 'log_timestamp',
          orderDirection: 'ASC'
        })
      });
      
      if (!logsResponse.ok) {
        throw new Error(`Failed to retrieve logs: ${logsResponse.status}`);
      }
      
      const logsData = await logsResponse.json();
      
      if (!logsData.logs || logsData.logs.length === 0) {
        return {
          content: [{ type: 'text', text: `No logs found for trace ID: ${traceId}` }]
        };
      }
      
      // Organize logs by service and span ID
      const logsByService = {};
      const logsBySpan = {};
      const errorLogs = [];
      const warningLogs = [];
      
      logsData.logs.forEach(log => {
        // Group by service
        if (!logsByService[log.service_name]) {
          logsByService[log.service_name] = [];
        }
        logsByService[log.service_name].push(log);
        
        // Group by span ID if available
        if (log.span_id) {
          if (!logsBySpan[log.span_id]) {
            logsBySpan[log.span_id] = [];
          }
          logsBySpan[log.span_id].push(log);
        }
        
        // Collect errors and warnings
        if (log.log_level === 'ERROR') {
          errorLogs.push(log);
        } else if (log.log_level === 'WARN') {
          warningLogs.push(log);
        }
      });
      
      // Calculate timing information
      const startTime = new Date(logsData.logs[0].log_timestamp);
      const endTime = new Date(logsData.logs[logsData.logs.length - 1].log_timestamp);
      const durationMs = endTime - startTime;
      
      // Prepare the prompt for the fine-tuned model
      let prompt = `Analyze the following distributed transaction logs with trace ID ${traceId}:\n\n`;
      
      // Add summary statistics
      prompt += `Transaction Summary:\n`;
      prompt += `- Total logs: ${logsData.logs.length}\n`;
      prompt += `- Services involved: ${Object.keys(logsByService).join(', ')}\n`;
      prompt += `- Spans: ${Object.keys(logsBySpan).length}\n`;
      prompt += `- Errors: ${errorLogs.length}\n`;
      prompt += `- Warnings: ${warningLogs.length}\n`;
      prompt += `- Duration: ${durationMs}ms\n\n`;
      
      // Add error logs if any
      if (errorLogs.length > 0) {
        prompt += `Error Logs:\n`;
        errorLogs.forEach(log => {
          prompt += `[${log.log_timestamp}] ${log.service_name} - ${log.message}\n`;
        });
        prompt += '\n';
      }
      
      // Add a sample of logs from each service
      prompt += `Sample Logs by Service:\n`;
      Object.keys(logsByService).forEach(service => {
        prompt += `${service}:\n`;
        // Take up to 5 logs per service
        const sampleLogs = logsByService[service].slice(0, 5);
        sampleLogs.forEach(log => {
          prompt += `  [${log.log_timestamp}] ${log.log_level} - ${log.message}\n`;
        });
      });
      
      // Add request for analysis based on detail level
      prompt += `\nBased on the above logs, provide a ${detailLevel} analysis of this distributed transaction. `;
      prompt += `Identify any issues, bottlenecks, or anomalies. `;
      prompt += `Explain the flow of the transaction across services and what might have gone wrong if there are errors.`;
      
      // Call the fine-tuned model for analysis
      const modelResponse = await fetch(`${this.env.MODEL_API_URL || 'http://localhost:8080/api/model/generate'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.MODEL_API_KEY}`
        },
        body: JSON.stringify({
          prompt: prompt,
          model_path: this.env.FINETUNED_MODEL_PATH || './models/log-analyzer',
          base_model_name: this.env.BASE_MODEL_NAME || 'unsloth/Llama-3.2-1B',
          max_new_tokens: detailLevel === 'expert' ? 1024 : (detailLevel === 'detailed' ? 512 : 256),
          temperature: 0.7
        })
      });
      
      if (!modelResponse.ok) {
        throw new Error(`Model API error: ${modelResponse.status}`);
      }
      
      const analysisResult = await modelResponse.json();
      
      // Format the final response
      const response = {
        traceId: traceId,
        analysisTimestamp: new Date().toISOString(),
        transactionDuration: `${durationMs}ms`,
        servicesInvolved: Object.keys(logsByService),
        errorCount: errorLogs.length,
        warningCount: warningLogs.length,
        analysis: analysisResult.generated_text || analysisResult.text || 'Analysis not available'
      };
      
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
      };
    } catch (error) {
      console.error('Error analyzing trace:', error);
      return {
        content: [{ type: 'text', text: `Error analyzing trace: ${error.message}` }],
        isError: true
      };
    }
  });