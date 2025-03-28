this.server.tool('generate_service_dependency_graph', z.object({ traceIds: z.array(z.string()).optional(), timeRangeHours: z.number().optional(), format: z.enum(['json', 'mermaid', 'dot']).optional() }).shape, async (params) => {
    /**
     * Generates a service dependency graph based on trace data
     * @param {string[]} [traceIds] - Optional list of specific trace IDs to analyze
     * @param {number} [timeRangeHours=24] - Time range in hours to analyze for service dependencies
     * @param {string} [format='json'] - Output format for the dependency graph
     */
    try {
      const traceIds = params.traceIds || [];
      const timeRangeHours = params.timeRangeHours || 24;
      const format = params.format || 'json';
      
      // If no specific trace IDs provided, get recent traces
      let tracesToAnalyze = traceIds;
      
      if (tracesToAnalyze.length === 0) {
        const traceResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/traces'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.DB_API_KEY}`
          },
          body: JSON.stringify({
            timeRangeHours: timeRangeHours,
            limit: 20 // Analyze up to 20 recent traces
          })
        });
        
        if (!traceResponse.ok) {
          throw new Error(`Failed to retrieve trace IDs: ${traceResponse.status}`);
        }
        
        const traceData = await traceResponse.json();
        tracesToAnalyze = traceData.traceIds || [];
        
        if (tracesToAnalyze.length === 0) {
          return {
            content: [{ type: 'text', text: 'No traces found in the specified time range.' }]
          };
        }
      }
      
      // Initialize dependency graph
      const dependencies = {};
      const serviceMetrics = {};
      
      // Process each trace
      for (const traceId of tracesToAnalyze) {
        const logsResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/query'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.DB_API_KEY}`
          },
          body: JSON.stringify({
            traceId: traceId,
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
        
        // Group logs by service and span ID
        const logsByService = {};
        const logsBySpan = {};
        
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
          
          // Initialize service in metrics if not exists
          if (!serviceMetrics[log.service_name]) {
            serviceMetrics[log.service_name] = {
              requestCount: 0,
              errorCount: 0,
              avgResponseTime: 0,
              totalResponseTime: 0
            };
          }
          
          // Update metrics
          if (log.message.includes('received request') || log.message.includes('starting')) {
            serviceMetrics[log.service_name].requestCount++;
          }
          if (log.log_level === 'ERROR') {
            serviceMetrics[log.service_name].errorCount++;
          }
        });
        
        // Analyze service dependencies based on log sequence
        const services = Object.keys(logsByService);
        for (let i = 0; i < services.length; i++) {
          const currentService = services[i];
          
          // Look for calls to other services in the logs
          logsByService[currentService].forEach(log => {
            const message = log.message.toLowerCase();
            
            // Look for patterns indicating service calls
            services.forEach(targetService => {
              if (targetService !== currentService && 
                  (message.includes(`calling ${targetService}`) || 
                   message.includes(`request to ${targetService}`) ||
                   message.includes(`${targetService} api`))) {
                
                // Add dependency
                if (!dependencies[currentService]) {
                  dependencies[currentService] = {};
                }
                if (!dependencies[currentService][targetService]) {
                  dependencies[currentService][targetService] = 0;
                }
                dependencies[currentService][targetService]++;
              }
            });
          });
        }
        
        // If we couldn't detect explicit dependencies, infer from sequence
        if (Object.keys(dependencies).length === 0 && services.length > 1) {
          // Sort services by their first appearance in the trace
          const serviceFirstTimestamp = {};
          services.forEach(service => {
            serviceFirstTimestamp[service] = new Date(logsByService[service][0].log_timestamp).getTime();
          });
          
          const sortedServices = services.sort((a, b) => serviceFirstTimestamp[a] - serviceFirstTimestamp[b]);
          
          // Create a chain of dependencies based on sequence
          for (let i = 0; i < sortedServices.length - 1; i++) {
            const currentService = sortedServices[i];
            const nextService = sortedServices[i + 1];
            
            if (!dependencies[currentService]) {
              dependencies[currentService] = {};
            }
            if (!dependencies[currentService][nextService]) {
              dependencies[currentService][nextService] = 0;
            }
            dependencies[currentService][nextService]++;
          }
        }
      }
      
      // Format the dependency graph according to the requested format
      let formattedGraph;
      
      if (format === 'json') {
        formattedGraph = {
          nodes: Object.keys(serviceMetrics).map(service => ({
            id: service,
            metrics: serviceMetrics[service]
          })),
          edges: []
        };
        
        // Add edges
        Object.keys(dependencies).forEach(source => {
          Object.keys(dependencies[source]).forEach(target => {
            formattedGraph.edges.push({
              source: source,
              target: target,
              weight: dependencies[source][target]
            });
          });
        });
        
        return {
          content: [{ type: 'text', text: JSON.stringify(formattedGraph, null, 2) }]
        };
      } else if (format === 'mermaid') {
        // Generate Mermaid flowchart
        let mermaidGraph = 'graph TD\n';
        
        // Add nodes
        Object.keys(serviceMetrics).forEach(service => {
          const metrics = serviceMetrics[service];
          const errorRate = metrics.requestCount > 0 ? 
            (metrics.errorCount / metrics.requestCount * 100).toFixed(1) + '%' : '0%';
          
          mermaidGraph += `  ${service}["${service}<br/>Requests: ${metrics.requestCount}<br/>Errors: ${errorRate}"]\n`;
        });
        
        // Add edges
        Object.keys(dependencies).forEach(source => {
          Object.keys(dependencies[source]).forEach(target => {
            mermaidGraph += `  ${source} -->|${dependencies[source][target]}| ${target}\n`;
          });
        });
        
        return {
          content: [{ type: 'text', text: mermaidGraph }]
        };
      } else if (format === 'dot') {
        // Generate DOT format for Graphviz
        let dotGraph = 'digraph ServiceDependencies {\n';
        dotGraph += '  rankdir=LR;\n';
        dotGraph += '  node [shape=box, style=filled, fillcolor=lightblue];\n\n';
        
        // Add nodes
        Object.keys(serviceMetrics).forEach(service => {
          const metrics = serviceMetrics[service];
          const errorRate = metrics.requestCount > 0 ? 
            (metrics.errorCount / metrics.requestCount * 100).toFixed(1) + '%' : '0%';
          
          dotGraph += `  "${service}" [label="${service}\nRequests: ${metrics.requestCount}\nErrors: ${errorRate}"]\n`;
        });
        
        dotGraph += '\n';
        
        // Add edges
        Object.keys(dependencies).forEach(source => {
          Object.keys(dependencies[source]).forEach(target => {
            dotGraph += `  "${source}" -> "${target}" [label="${dependencies[source][target]}"]\n`;
          });
        });
        
        dotGraph += '}\n';
        
        return {
          content: [{ type: 'text', text: dotGraph }]
        };
      }
      
      // Should never reach here due to zod validation
      throw new Error(`Unsupported format: ${format}`);
    } catch (error) {
      console.error('Error generating service dependency graph:', error);
      return {
        content: [{ type: 'text', text: `Error generating service dependency graph: ${error.message}` }],
        isError: true
      };
    }
  });