this.server.tool('real_time_log_monitor', z.object({ monitoringDuration: z.number().optional(), alertThreshold: z.enum(['low', 'medium', 'high']).optional(), services: z.array(z.string()).optional(), includeHealthyTraces: z.boolean().optional() }).shape, async (params) => {
    /**
     * Monitors logs in real-time, analyzing incoming traces and providing immediate alerts for potential issues
     * @param {number} [monitoringDuration=60] - Duration in seconds to monitor logs (0 for continuous until timeout)
     * @param {string} [alertThreshold='medium'] - Threshold for alerting (low, medium, high)
     * @param {string[]} [services] - Optional list of specific services to monitor (all services if not specified)
     * @param {boolean} [includeHealthyTraces=false] - Whether to include healthy traces in the results
     */
    try {
      const monitoringDuration = params.monitoringDuration || 60; // Default to 60 seconds
      const alertThreshold = params.alertThreshold || 'medium';
      const services = params.services || [];
      const includeHealthyTraces = params.includeHealthyTraces || false;
      
      // Set alert thresholds based on level
      const thresholds = {
        low: {
          errorCountThreshold: 3,
          warningCountThreshold: 5,
          latencyMsThreshold: 1000,
          serviceGapMsThreshold: 500
        },
        medium: {
          errorCountThreshold: 2,
          warningCountThreshold: 3,
          latencyMsThreshold: 500,
          serviceGapMsThreshold: 300
        },
        high: {
          errorCountThreshold: 1,
          warningCountThreshold: 2,
          latencyMsThreshold: 200,
          serviceGapMsThreshold: 100
        }
      }[alertThreshold];
      
      // Initialize monitoring state
      const monitoringStart = Date.now();
      const monitoringEnd = monitoringDuration > 0 ? monitoringStart + (monitoringDuration * 1000) : Infinity;
      
      // Keep track of active traces and their status
      const activeTraces = new Map();
      const completedTraces = [];
      const alerts = [];
      
      // Function to process a batch of logs
      const processLogBatch = async (lastTimestamp) => {
        const logsResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/recent'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.DB_API_KEY}`
          },
          body: JSON.stringify({
            afterTimestamp: lastTimestamp,
            limit: 100,
            services: services.length > 0 ? services : undefined
          })
        });
        
        if (!logsResponse.ok) {
          throw new Error(`Failed to retrieve recent logs: ${logsResponse.status}`);
        }
        
        const logsData = await logsResponse.json();
        
        if (!logsData.logs || logsData.logs.length === 0) {
          return lastTimestamp; // No new logs
        }
        
        // Process each log
        let newLastTimestamp = lastTimestamp;
        
        for (const log of logsData.logs) {
          // Update the last timestamp
          const logTimestamp = new Date(log.log_timestamp).getTime();
          if (logTimestamp > newLastTimestamp) {
            newLastTimestamp = logTimestamp;
          }
          
          // Skip logs without trace IDs
          if (!log.trace_id) continue;
          
          // Get or create trace info
          if (!activeTraces.has(log.trace_id)) {
            activeTraces.set(log.trace_id, {
              traceId: log.trace_id,
              startTime: logTimestamp,
              lastUpdateTime: logTimestamp,
              services: new Set([log.service_name]),
              logs: [log],
              errorCount: 0,
              warningCount: 0,
              status: 'active',
              spans: new Map()
            });
          }
          
          const traceInfo = activeTraces.get(log.trace_id);
          traceInfo.lastUpdateTime = logTimestamp;
          traceInfo.services.add(log.service_name);
          traceInfo.logs.push(log);
          
          // Track span information if available
          if (log.span_id) {
            if (!traceInfo.spans.has(log.span_id)) {
              traceInfo.spans.set(log.span_id, {
                spanId: log.span_id,
                service: log.service_name,
                startTime: logTimestamp,
                endTime: null,
                logs: []
              });
            }
            
            const spanInfo = traceInfo.spans.get(log.span_id);
            spanInfo.logs.push(log);
            
            // Check for span completion indicators in the log message
            if (log.message.toLowerCase().includes('completed') || 
                log.message.toLowerCase().includes('finished') ||
                log.message.toLowerCase().includes('ended')) {
              spanInfo.endTime = logTimestamp;
            }
          }
          
          // Count errors and warnings
          if (log.log_level === 'ERROR') {
            traceInfo.errorCount++;
          } else if (log.log_level === 'WARN') {
            traceInfo.warningCount++;
          }
          
          // Check for trace completion indicators
          if (log.message.toLowerCase().includes('transaction completed') || 
              log.message.toLowerCase().includes('request completed') ||
              log.message.toLowerCase().includes('process completed')) {
            traceInfo.status = 'completed';
          }
        }
        
        // Check for traces that need to be analyzed
        const now = Date.now();
        const tracesToAnalyze = [];
        
        activeTraces.forEach((traceInfo, traceId) => {
          // Check if trace is completed or timed out
          const traceAge = now - traceInfo.startTime;
          const timeSinceLastUpdate = now - traceInfo.lastUpdateTime;
          
          // Mark as timed out if no updates in 30 seconds
          if (timeSinceLastUpdate > 30000 && traceInfo.status === 'active') {
            traceInfo.status = 'timed_out';
          }
          
          // Analyze traces that are completed, timed out, or have errors exceeding threshold
          if (traceInfo.status !== 'active' || 
              traceInfo.errorCount >= thresholds.errorCountThreshold || 
              traceInfo.warningCount >= thresholds.warningCountThreshold) {
            tracesToAnalyze.push(traceId);
          }
        });
        
        // Analyze traces that need attention
        for (const traceId of tracesToAnalyze) {
          const traceInfo = activeTraces.get(traceId);
          activeTraces.delete(traceId);
          
          // Skip healthy traces if not requested
          if (!includeHealthyTraces && 
              traceInfo.errorCount === 0 && 
              traceInfo.warningCount < thresholds.warningCountThreshold) {
            completedTraces.push({
              traceId: traceInfo.traceId,
              status: traceInfo.status,
              services: Array.from(traceInfo.services),
              duration: traceInfo.lastUpdateTime - traceInfo.startTime,
              errorCount: traceInfo.errorCount,
              warningCount: traceInfo.warningCount
            });
            continue;
          }
          
          // Analyze the trace
          let analysisText = '';
          let alertLevel = 'info';
          
          // Check for errors
          if (traceInfo.errorCount > 0) {
            alertLevel = 'error';
            const errorLogs = traceInfo.logs.filter(log => log.log_level === 'ERROR');
            analysisText += `Found ${traceInfo.errorCount} errors. `;
            analysisText += `First error: ${errorLogs[0].message} in service ${errorLogs[0].service_name}. `;
          }
          // Check for warnings
          else if (traceInfo.warningCount >= thresholds.warningCountThreshold) {
            alertLevel = 'warning';
            analysisText += `Found ${traceInfo.warningCount} warnings. `;
          }
          // Check for timeouts
          else if (traceInfo.status === 'timed_out') {
            alertLevel = 'warning';
            analysisText += `Trace timed out after ${Math.round((traceInfo.lastUpdateTime - traceInfo.startTime) / 1000)}s of inactivity. `;
          }
          
          // Check for service gaps
          if (traceInfo.spans.size > 1) {
            // Sort spans by start time
            const sortedSpans = Array.from(traceInfo.spans.values())
              .sort((a, b) => a.startTime - b.startTime);
            
            // Check for gaps between spans
            for (let i = 1; i < sortedSpans.length; i++) {
              const prevSpan = sortedSpans[i-1];
              const currentSpan = sortedSpans[i];
              
              if (prevSpan.endTime && currentSpan.startTime - prevSpan.endTime > thresholds.serviceGapMsThreshold) {
                const gapMs = currentSpan.startTime - prevSpan.endTime;
                analysisText += `Detected ${gapMs}ms gap between ${prevSpan.service} and ${currentSpan.service}. `;
                if (alertLevel === 'info') alertLevel = 'warning';
              }
            }
          }
          
          // Check overall latency
          const traceDuration = traceInfo.lastUpdateTime - traceInfo.startTime;
          if (traceDuration > thresholds.latencyMsThreshold) {
            analysisText += `Total trace duration (${traceDuration}ms) exceeds threshold (${thresholds.latencyMsThreshold}ms). `;
            if (alertLevel === 'info') alertLevel = 'warning';
          }
          
          // Add service flow
          analysisText += `Service flow: ${Array.from(traceInfo.services).join(' → ')}.`;
          
          // Create alert if needed
          if (alertLevel !== 'info' || includeHealthyTraces) {
            alerts.push({
              timestamp: new Date().toISOString(),
              traceId: traceInfo.traceId,
              level: alertLevel,
              services: Array.from(traceInfo.services),
              duration: traceDuration,
              errorCount: traceInfo.errorCount,
              warningCount: traceInfo.warningCount,
              status: traceInfo.status,
              analysis: analysisText
            });
          }
          
          completedTraces.push({
            traceId: traceInfo.traceId,
            status: traceInfo.status,
            services: Array.from(traceInfo.services),
            duration: traceDuration,
            errorCount: traceInfo.errorCount,
            warningCount: traceInfo.warningCount
          });
        }
        
        return newLastTimestamp;
      };
      
      // Start monitoring loop
      let lastTimestamp = Date.now() - 60000; // Start with logs from the last minute
      const startTime = Date.now();
      
      // For real implementation, this would be a continuous loop with streaming responses
      // For this example, we'll do a fixed number of polling iterations
      const maxIterations = monitoringDuration > 0 ? Math.ceil(monitoringDuration / 5) : 12; // Poll every 5 seconds, max 1 minute
      
      for (let i = 0; i < maxIterations; i++) {
        // Check if monitoring duration has elapsed
        if (Date.now() >= monitoringEnd) break;
        
        // Process a batch of logs
        lastTimestamp = await processLogBatch(lastTimestamp);
        
        // In a real implementation, we would wait between polls
        // For this example, we'll simulate the passage of time
        if (i < maxIterations - 1) {
          // Simulate 5 second wait between polls
        }
      }
      
      // Prepare final response
      const monitoringDurationMs = Date.now() - startTime;
      
      const response = {
        monitoringDuration: `${(monitoringDurationMs / 1000).toFixed(1)} seconds`,
        alertThreshold: alertThreshold,
        servicesMonitored: services.length > 0 ? services : 'all',
        tracesAnalyzed: completedTraces.length,
        activeTraceCount: activeTraces.size,
        alertCount: alerts.length,
        alerts: alerts,
        alertSummary: {
          error: alerts.filter(a => a.level === 'error').length,
          warning: alerts.filter(a => a.level === 'warning').length,
          info: alerts.filter(a => a.level === 'info').length
        }
      };
      
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
      };
    } catch (error) {
      console.error('Error in real-time log monitoring:', error);
      return {
        content: [{ type: 'text', text: `Error in real-time log monitoring: ${error.message}` }],
        isError: true
      };
    }
  });