this.server.tool('analyze_distributed_trace', z.object({
    processedLogPath: z.string().describe('Path to the processed log data JSON file'),
    traceId: z.string().optional().describe('Specific trace ID to analyze (if not provided, will analyze all traces)'),
    outputPath: z.string().optional().describe('Path to save the trace analysis results (if not provided, will only return the analysis)'),
    maxTraces: z.number().optional().describe('Maximum number of traces to analyze (default: 10)'),
    includeVisualization: z.boolean().optional().describe('Whether to include trace visualization (default: true)')
  }).shape, async (params) => {
    /** Analyze distributed traces by following trace and span IDs across services */
    try {
      const {
        processedLogPath,
        traceId,
        outputPath,
        maxTraces = 10,
        includeVisualization = true
      } = params;
      
      const script = `
  import json
  import os
  import re
  import pandas as pd
  import numpy as np
  import networkx as nx
  import matplotlib.pyplot as plt
  import matplotlib
  matplotlib.use('Agg')  # Use non-interactive backend
  import base64
  from io import BytesIO
  from datetime import datetime
  from collections import defaultdict, Counter
  
  try:
      # Load processed log data
      with open(${JSON.stringify(processedLogPath)}, 'r', encoding='utf-8') as f:
          logs = json.load(f)
      
      # Function to parse timestamp
      def parse_timestamp(ts_str):
          try:
              # Try common formats
              formats = [
                  '%Y-%m-%dT%H:%M:%S.%fZ',
                  '%Y-%m-%dT%H:%M:%S.%f%z',
                  '%Y-%m-%dT%H:%M:%S%z',
                  '%Y-%m-%dT%H:%M:%SZ',
                  '%Y-%m-%d %H:%M:%S.%f',
                  '%Y-%m-%d %H:%M:%S'
              ]
              
              for fmt in formats:
                  try:
                      return datetime.strptime(ts_str, fmt)
                  except ValueError:
                      continue
              
              # Try with dateutil as fallback
              from dateutil import parser
              return parser.parse(ts_str)
          except:
              return None
      
      # Group logs by trace ID
      trace_groups = defaultdict(list)
      for log in logs:
          trace_id = log.get("traceId")
          if trace_id:
              trace_groups[trace_id].append(log)
      
      # If specific trace ID is provided, filter to just that trace
      if ${JSON.stringify(traceId !== undefined)}:
          specific_trace_id = ${JSON.stringify(traceId || '')}
          if specific_trace_id in trace_groups:
              trace_groups = {specific_trace_id: trace_groups[specific_trace_id]}
          else:
              raise ValueError(f"Trace ID {specific_trace_id} not found in logs")
      
      # Limit to max traces if needed
      if len(trace_groups) > ${maxTraces}:
          # Sort traces by size (number of logs) and take the largest ones
          sorted_traces = sorted(trace_groups.items(), key=lambda x: len(x[1]), reverse=True)
          trace_groups = dict(sorted_traces[:${maxTraces}])
      
      # Analyze each trace
      trace_analyses = []
      trace_visualizations = []
      
      for trace_id, trace_logs in trace_groups.items():
          # Skip traces with too few logs
          if len(trace_logs) < 2:
              continue
              
          # Create a DataFrame for easier analysis
          df = pd.DataFrame(trace_logs)
          
          # Extract span relationships
          spans = defaultdict(dict)
          for log in trace_logs:
              span_id = log.get("spanId")
              if span_id:
                  if span_id not in spans:
                      spans[span_id] = {
                          "parent_span": log.get("parentSpanId"),
                          "logs": [],
                          "service": log.get("service"),
                          "start_time": None,
                          "end_time": None,
                          "duration_ms": None,
                          "status": "unknown"
                      }
                  
                  # Add log to span
                  spans[span_id]["logs"].append(log)
                  
                  # Update service if not set
                  if not spans[span_id]["service"] and log.get("service"):
                      spans[span_id]["service"] = log.get("service")
                  
                  # Check for timestamp
                  timestamp = log.get("timestamp")
                  if timestamp:
                      ts = parse_timestamp(timestamp)
                      if ts:
                          if spans[span_id]["start_time"] is None or ts < spans[span_id]["start_time"]:
                              spans[span_id]["start_time"] = ts
                          if spans[span_id]["end_time"] is None or ts > spans[span_id]["end_time"]:
                              spans[span_id]["end_time"] = ts
                  
                  # Check for error or success indicators
                  message = log.get("message", "")
                  level = log.get("level", "")
                  
                  if level and level.upper() in ["ERROR", "SEVERE", "FATAL", "CRITICAL"]:
                      spans[span_id]["status"] = "error"
                  elif re.search(r'exception|error|fail|timeout', message, re.IGNORECASE):
                      spans[span_id]["status"] = "error"
                  elif re.search(r'success|successful|completed', message, re.IGNORECASE):
                      spans[span_id]["status"] = "success"
          
          # Calculate span durations
          for span_id, span in spans.items():
              if span["start_time"] and span["end_time"]:
                  span["duration_ms"] = (span["end_time"] - span["start_time"]).total_seconds() * 1000
          
          # Build span hierarchy
          root_spans = []
          for span_id, span in spans.items():
              if not span["parent_span"] or span["parent_span"] not in spans:
                  root_spans.append(span_id)
          
          # Calculate trace duration
          trace_start = min([span["start_time"] for span in spans.values() if span["start_time"]], default=None)
          trace_end = max([span["end_time"] for span in spans.values() if span["end_time"]], default=None)
          trace_duration_ms = None
          if trace_start and trace_end:
              trace_duration_ms = (trace_end - trace_start).total_seconds() * 1000
          
          # Count services involved
          services = set([span["service"] for span in spans.values() if span["service"]])
          
          # Check for errors in the trace
          error_spans = [span_id for span_id, span in spans.items() if span["status"] == "error"]
          has_errors = len(error_spans) > 0
          
          # Create service flow graph
          G = nx.DiGraph()
          
          # Add nodes for each service
          for service in services:
              G.add_node(service)
          
          # Add edges for service interactions
          for span_id, span in spans.items():
              if span["parent_span"] and span["parent_span"] in spans:
                  parent_service = spans[span["parent_span"]]["service"]
                  child_service = span["service"]
                  
                  if parent_service and child_service and parent_service != child_service:
                      if G.has_edge(parent_service, child_service):
                          G[parent_service][child_service]["weight"] += 1
                      else:
                          G.add_edge(parent_service, child_service, weight=1)
          
          # Generate visualization if requested
          visualization_data = None
          if ${includeVisualization}:
              plt.figure(figsize=(10, 8))
              
              # Create positions for nodes
              pos = nx.spring_layout(G)
              
              # Draw nodes with different colors based on error status
              node_colors = []
              for service in G.nodes():
                  # Check if any spans from this service have errors
                  service_spans = [span_id for span_id, span in spans.items() if span["service"] == service]
                  service_has_error = any(span_id in error_spans for span_id in service_spans)
                  
                  if service_has_error:
                      node_colors.append('red')
                  else:
                      node_colors.append('lightblue')
              
              # Draw the graph
              nx.draw_networkx_nodes(G, pos, node_color=node_colors, node_size=500, alpha=0.8)
              nx.draw_networkx_labels(G, pos, font_size=10)
              
              # Draw edges with width proportional to weight
              edge_widths = [G[u][v]['weight'] for u, v in G.edges()]
              nx.draw_networkx_edges(G, pos, width=edge_widths, alpha=0.5, edge_color='gray', arrows=True, arrowsize=15)
              
              # Add edge labels showing count of interactions
              edge_labels = {(u, v): f"{G[u][v]['weight']}" for u, v in G.edges()}
              nx.draw_networkx_edge_labels(G, pos, edge_labels=edge_labels, font_size=8)
              
              plt.title(f"Service Interaction Graph for Trace {trace_id}")
              plt.axis('off')
              
              # Save to BytesIO object
              buffer = BytesIO()
              plt.savefig(buffer, format='png', dpi=100)
              plt.close()
              
              # Convert to base64
              buffer.seek(0)
              img_str = base64.b64encode(buffer.read()).decode('utf-8')
              visualization_data = img_str
          
          # Create trace analysis
          analysis = {
              "trace_id": trace_id,
              "span_count": len(spans),
              "log_count": len(trace_logs),
              "services": list(services),
              "service_count": len(services),
              "root_spans": root_spans,
              "has_errors": has_errors,
              "error_spans": error_spans,
              "trace_duration_ms": trace_duration_ms,
              "spans": {}
          }
          
          # Add span details (limit log content for brevity)
          for span_id, span in spans.items():
              analysis["spans"][span_id] = {
                  "service": span["service"],
                  "parent_span": span["parent_span"],
                  "status": span["status"],
                  "duration_ms": span["duration_ms"],
                  "log_count": len(span["logs"]),
                  "sample_logs": [{
                      "timestamp": log.get("timestamp"),
                      "level": log.get("level"),
                      "message": log.get("message", "")[:200] + ("..." if log.get("message", "") and len(log.get("message", "")) > 200 else "")
                  } for log in span["logs"][:3]]  # Include only first 3 logs per span
              }
          
          trace_analyses.append(analysis)
          
          if visualization_data:
              trace_visualizations.append({
                  "trace_id": trace_id,
                  "visualization": visualization_data
              })
      
      # Create final analysis result
      result = {
          "traces_analyzed": len(trace_analyses),
          "trace_analyses": trace_analyses
      }
      
      # Add visualizations if generated
      if trace_visualizations:
          result["visualizations"] = trace_visualizations
      
      # Save to file if output path provided
      if ${JSON.stringify(outputPath !== undefined)}:
          output_path = ${JSON.stringify(outputPath || '')}
          os.makedirs(os.path.dirname(output_path), exist_ok=True)
          
          with open(output_path, 'w', encoding='utf-8') as f:
              json.dump(result, f, indent=2, default=str)
      
      # Generate summary for display
      summary = {
          "traces_analyzed": len(trace_analyses),
          "trace_summaries": []
      }
      
      for analysis in trace_analyses:
          summary["trace_summaries"].append({
              "trace_id": analysis["trace_id"],
              "span_count": analysis["span_count"],
              "log_count": analysis["log_count"],
              "service_count": analysis["service_count"],
              "services": analysis["services"],
              "has_errors": analysis["has_errors"],
              "trace_duration_ms": analysis["trace_duration_ms"]
          })
      
      if trace_visualizations:
          summary["has_visualizations"] = True
          summary["visualization_count"] = len(trace_visualizations)
      
      if ${JSON.stringify(outputPath !== undefined)}:
          summary["output_path"] = ${JSON.stringify(outputPath || '')}
      
      print(json.dumps(summary, default=str))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error analyzing distributed traces: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Distributed Trace Analysis:\n\n`;
        responseText += `- Traces analyzed: ${result.traces_analyzed}\n`;
        
        if (outputPath && result.output_path) {
          responseText += `- Full analysis saved to: ${result.output_path}\n`;
        }
        
        if (result.has_visualizations) {
          responseText += `- Service interaction visualizations generated: ${result.visualization_count}\n`;
        }
        
        responseText += `\nTrace Summaries:\n`;
        
        for (const trace of result.trace_summaries) {
          responseText += `\nTrace ID: ${trace.trace_id}\n`;
          responseText += `- Services involved: ${trace.service_count} (${trace.services.join(', ')})\n`;
          responseText += `- Spans: ${trace.span_count}\n`;
          responseText += `- Logs: ${trace.log_count}\n`;
          
          if (trace.trace_duration_ms) {
            responseText += `- Duration: ${Math.round(trace.trace_duration_ms)}ms\n`;
          }
          
          if (trace.has_errors) {
            responseText += `- Status: ⚠️ Contains errors\n`;
          } else {
            responseText += `- Status: ✅ No errors detected\n`;
          }
        }
        
        // If we have visualizations, include the first one as an image
        const content = [{ type: 'text', text: responseText }];
        
        if (result.has_visualizations && includeVisualization && result.trace_summaries.length > 0) {
          // We need to fetch the visualization data from the full analysis file
          if (outputPath) {
            try {
              const fs = require('fs');
              const fullAnalysis = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
              
              if (fullAnalysis.visualizations && fullAnalysis.visualizations.length > 0) {
                const firstViz = fullAnalysis.visualizations[0];
                content.push({
                  type: 'image',
                  data: firstViz.visualization,
                  mimeType: 'image/png'
                });
                
                // Add a caption for the image
                content.push({
                  type: 'text',
                  text: `Service Interaction Graph for Trace ${firstViz.trace_id}`
                });
              }
            } catch (error) {
              console.error('Error reading visualization from file:', error);
            }
          }
        }
        
        return { content };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing trace analysis results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in analyze_distributed_trace tool:', error);
      return {
        content: [{ type: 'text', text: `Error analyzing distributed traces: ${error.message}` }],
        isError: true
      };
    }
  });