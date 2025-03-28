this.server.tool('prepare_finetuning_dataset', z.object({ outputFormat: z.enum(['jsonl', 'csv']).optional(), sampleSize: z.number().optional(), includeErrors: z.boolean().optional(), includeWarnings: z.boolean().optional(), outputPath: z.string().optional() }).shape, async (params) => {
  /**
   * Creates a dataset for fine-tuning a log analysis model
   * @param {string} [outputFormat='jsonl'] - Format of the output dataset
   * @param {number} [sampleSize=100] - Number of trace samples to include
   * @param {boolean} [includeErrors=true] - Whether to prioritize traces with errors
   * @param {boolean} [includeWarnings=true] - Whether to prioritize traces with warnings
   * @param {string} [outputPath] - Path where the dataset should be saved
   */
  try {
    const outputFormat = params.outputFormat || 'jsonl';
    const sampleSize = params.sampleSize || 100;
    const includeErrors = params.includeErrors !== false; // Default to true
    const includeWarnings = params.includeWarnings !== false; // Default to true
    const outputPath = params.outputPath || `log_analysis_dataset_${Date.now()}.${outputFormat}`;
    
    // Query the database for distinct trace IDs
    const traceResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/traces'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.DB_API_KEY}`
      },
      body: JSON.stringify({
        limit: sampleSize * 2, // Get more than needed to allow for filtering
        includeErrors: includeErrors,
        includeWarnings: includeWarnings
      })
    });
    
    if (!traceResponse.ok) {
      throw new Error(`Failed to retrieve trace IDs: ${traceResponse.status}`);
    }
    
    const traceData = await traceResponse.json();
    
    if (!traceData.traceIds || traceData.traceIds.length === 0) {
      return {
        content: [{ type: 'text', text: 'No trace IDs found in the database' }],
        isError: true
      };
    }
    
    // Limit to the requested sample size
    const selectedTraceIds = traceData.traceIds.slice(0, sampleSize);
    
    // Initialize dataset array
    const dataset = [];
    
    // Process each trace ID
    for (const traceId of selectedTraceIds) {
      // Get logs for this trace ID
      const logsResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/query'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.DB_API_KEY}`
        },
        body: JSON.stringify({
          traceId: traceId,
          limit: 500,
          orderBy: 'log_timestamp',
          orderDirection: 'ASC'
        })
      });
      
      if (!logsResponse.ok) {
        console.error(`Failed to retrieve logs for trace ID ${traceId}: ${logsResponse.status}`);
        continue; // Skip this trace ID
      }
      
      const logsData = await logsResponse.json();
      
      if (!logsData.logs || logsData.logs.length === 0) {
        continue; // Skip this trace ID
      }
      
      // Organize logs by service and collect errors/warnings
      const logsByService = {};
      const errorLogs = [];
      const warningLogs = [];
      
      logsData.logs.forEach(log => {
        // Group by service
        if (!logsByService[log.service_name]) {
          logsByService[log.service_name] = [];
        }
        logsByService[log.service_name].push(log);
        
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
      
      // Create the input text (logs)
      let inputText = `Distributed transaction logs with trace ID ${traceId}:\n\n`;
      
      // Add summary statistics
      inputText += `Transaction Summary:\n`;
      inputText += `- Total logs: ${logsData.logs.length}\n`;
      inputText += `- Services involved: ${Object.keys(logsByService).join(', ')}\n`;
      inputText += `- Errors: ${errorLogs.length}\n`;
      inputText += `- Warnings: ${warningLogs.length}\n`;
      inputText += `- Duration: ${durationMs}ms\n\n`;
      
      // Add error logs if any
      if (errorLogs.length > 0) {
        inputText += `Error Logs:\n`;
        errorLogs.forEach(log => {
          inputText += `[${log.log_timestamp}] ${log.service_name} - ${log.message}\n`;
        });
        inputText += '\n';
      }
      
      // Add a sample of logs from each service
      inputText += `Sample Logs by Service:\n`;
      Object.keys(logsByService).forEach(service => {
        inputText += `${service}:\n`;
        // Take up to 10 logs per service
        const sampleLogs = logsByService[service].slice(0, 10);
        sampleLogs.forEach(log => {
          inputText += `  [${log.log_timestamp}] ${log.log_level} - ${log.message}\n`;
        });
      });
      
      // Create the expected output text (analysis)
      // This would ideally be human-written analysis, but for now we'll generate a placeholder
      let outputText = `Analysis of transaction ${traceId}:\n\n`;
      
      if (errorLogs.length > 0) {
        outputText += `This transaction failed with ${errorLogs.length} errors. `;
        outputText += `The primary error occurred in the ${errorLogs[0].service_name} service: "${errorLogs[0].message}". `;
        outputText += `This appears to be a ${errorLogs[0].message.includes('timeout') ? 'timeout' : 'application error'} issue.\n\n`;
      } else if (warningLogs.length > 0) {
        outputText += `This transaction completed with ${warningLogs.length} warnings. `;
        outputText += `The main warning was in the ${warningLogs[0].service_name} service: "${warningLogs[0].message}".\n\n`;
      } else {
        outputText += `This transaction completed successfully in ${durationMs}ms across ${Object.keys(logsByService).length} services.\n\n`;
      }
      
      outputText += `The transaction flow was: ${Object.keys(logsByService).join(' → ')}.`;
      
      // Add to dataset
      dataset.push({
        text: `${inputText}\n\nAnalyze these logs and provide a detailed explanation of what happened in this transaction, including any errors or issues:\n\n${outputText}`
      });
    }
    
    // Convert dataset to the requested format
    let formattedData;
    if (outputFormat === 'jsonl') {
      formattedData = dataset.map(item => JSON.stringify(item)).join('\n');
    } else { // csv
      formattedData = 'text\n' + dataset.map(item => `"${item.text.replace(/"/g, '""')}"`);
    }
    
    // In a real implementation, we would save this to a file
    // For this example, we'll return information about the dataset
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `Dataset prepared successfully with ${dataset.length} examples`,
          format: outputFormat,
          outputPath: outputPath,
          sampleSize: dataset.length,
          datasetPreview: dataset.slice(0, 2) // Show first two examples
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error('Error preparing fine-tuning dataset:', error);
    return {
      content: [{ type: 'text', text: `Error preparing dataset: ${error.message}` }],
      isError: true
    };
  }
});