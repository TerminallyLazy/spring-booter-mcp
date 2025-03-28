this.server.tool('generate_log_analysis_report', z.object({
    processedLogPath: z.string().describe('Path to the processed log data JSON file'),
    outputPath: z.string().describe('Path to save the analysis report'),
    reportFormat: z.enum(['html', 'markdown', 'json']).optional().describe('Format of the report (default: html)'),
    timeRange: z.object({
      startTime: z.string().optional().describe('Start time for the analysis period (ISO format)'),
      endTime: z.string().optional().describe('End time for the analysis period (ISO format)')
    }).optional().describe('Time range for the analysis'),
    includeCharts: z.boolean().optional().describe('Whether to include charts and visualizations (default: true)'),
    focusAreas: z.object({
      errors: z.boolean().optional().describe('Focus on error analysis (default: true)'),
      performance: z.boolean().optional().describe('Focus on performance analysis (default: true)'),
      traces: z.boolean().optional().describe('Focus on trace analysis (default: true)'),
      anomalies: z.boolean().optional().describe('Focus on anomaly detection (default: true)')
    }).optional().describe('Areas to focus on in the report')
  }).shape, async (params) => {
    /** Generate a comprehensive analysis report from processed log data */
    try {
      const {
        processedLogPath,
        outputPath,
        reportFormat = 'html',
        timeRange = {},
        includeCharts = true,
        focusAreas = {
          errors: true,
          performance: true,
          traces: true,
          anomalies: true
        }
      } = params;
      
      const script = `
  import json
  import os
  import re
  import pandas as pd
  import numpy as np
  import matplotlib
  matplotlib.use('Agg')  # Use non-interactive backend
  import matplotlib.pyplot as plt
  import seaborn as sns
  import networkx as nx
  import base64
  from io import BytesIO
  from datetime import datetime
  from collections import defaultdict, Counter
  from sklearn.ensemble import IsolationForest
  
  try:
      # Load processed log data
      with open(${JSON.stringify(processedLogPath)}, 'r', encoding='utf-8') as f:
          logs = json.load(f)
      
      # Convert to DataFrame for easier analysis
      df = pd.DataFrame(logs)
      
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
      
      # Apply time range filter if specified
      if ${JSON.stringify(!!timeRange.startTime)} or ${JSON.stringify(!!timeRange.endTime)}:
          # Find timestamp column
          timestamp_col = None
          for col in ['timestamp', 'time', 'date', '@timestamp']:
              if col in df.columns:
                  timestamp_col = col
                  break
          
          if timestamp_col:
              # Parse timestamps
              df['parsed_timestamp'] = df[timestamp_col].apply(parse_timestamp)
              
              # Filter by start time
              if ${JSON.stringify(!!timeRange.startTime)}:
                  start_time = parse_timestamp(${JSON.stringify(timeRange.startTime || '')})
                  if start_time:
                      df = df[df['parsed_timestamp'] >= start_time]
              
              # Filter by end time
              if ${JSON.stringify(!!timeRange.endTime)}:
                  end_time = parse_timestamp(${JSON.stringify(timeRange.endTime || '')})
                  if end_time:
                      df = df[df['parsed_timestamp'] <= end_time]
      
      # Initialize report data
      report = {
          "title": "Log Analysis Report",
          "generated_at": datetime.now().isoformat(),
          "log_count": len(df),
          "time_period": {
              "start": df['parsed_timestamp'].min().isoformat() if 'parsed_timestamp' in df.columns and not df['parsed_timestamp'].isna().all() else None,
              "end": df['parsed_timestamp'].max().isoformat() if 'parsed_timestamp' in df.columns and not df['parsed_timestamp'].isna().all() else None
          },
          "sections": []
      }
      
      # Generate overview section
      overview = {
          "title": "Overview",
          "content": []
      }
      
      # Basic statistics
      overview["content"].append({
          "type": "text",
          "content": f"Total logs analyzed: {len(df)}"
      })
      
      # Service distribution
      if 'service' in df.columns:
          service_counts = df['service'].value_counts().to_dict()
          overview["content"].append({
              "type": "text",
              "content": f"Services: {len(service_counts)}"
          })
          
          # Add service distribution chart
          if ${includeCharts} and len(service_counts) > 0:
              plt.figure(figsize=(10, 6))
              service_df = pd.DataFrame(list(service_counts.items()), columns=['Service', 'Count'])
              service_df = service_df.sort_values('Count', ascending=False).head(10)  # Top 10 services
              
              sns.barplot(x='Count', y='Service', data=service_df)
              plt.title('Top 10 Services by Log Count')
              plt.tight_layout()
              
              # Save to BytesIO
              buffer = BytesIO()
              plt.savefig(buffer, format='png')
              plt.close()
              
              # Convert to base64
              buffer.seek(0)
              img_str = base64.b64encode(buffer.read()).decode('utf-8')
              
              overview["content"].append({
                  "type": "chart",
                  "title": "Service Distribution",
                  "image_data": img_str
              })
      
      # Log level distribution
      if 'level' in df.columns:
          level_counts = df['level'].value_counts().to_dict()
          overview["content"].append({
              "type": "text",
              "content": f"Log Levels: {', '.join([f'{k}: {v}' for k, v in level_counts.items()])}"
          })
          
          # Add log level distribution chart
          if ${includeCharts} and len(level_counts) > 0:
              plt.figure(figsize=(8, 6))
              level_df = pd.DataFrame(list(level_counts.items()), columns=['Level', 'Count'])
              
              # Define color map for log levels
              color_map = {
                  'ERROR': 'red',
                  'WARN': 'orange',
                  'WARNING': 'orange',
                  'INFO': 'blue',
                  'DEBUG': 'green',
                  'TRACE': 'purple'
              }
              
              # Assign colors
              colors = [color_map.get(level.upper(), 'gray') for level in level_df['Level']]
              
              plt.pie(level_df['Count'], labels=level_df['Level'], autopct='%1.1f%%', colors=colors)
              plt.title('Log Level Distribution')
              plt.axis('equal')
              
              # Save to BytesIO
              buffer = BytesIO()
              plt.savefig(buffer, format='png')
              plt.close()
              
              # Convert to base64
              buffer.seek(0)
              img_str = base64.b64encode(buffer.read()).decode('utf-8')
              
              overview["content"].append({
                  "type": "chart",
                  "title": "Log Level Distribution",
                  "image_data": img_str
              })
      
      # Time distribution
      if 'parsed_timestamp' in df.columns and not df['parsed_timestamp'].isna().all():
          # Add hourly distribution chart
          if ${includeCharts}:
              plt.figure(figsize=(12, 6))
              
              # Extract hour
              df['hour'] = df['parsed_timestamp'].dt.hour
              hourly_counts = df['hour'].value_counts().sort_index()
              
              # Plot
              plt.bar(hourly_counts.index, hourly_counts.values)
              plt.title('Log Distribution by Hour of Day')
              plt.xlabel('Hour of Day')
              plt.ylabel('Log Count')
              plt.xticks(range(0, 24))
              plt.grid(axis='y', linestyle='--', alpha=0.7)
              
              # Save to BytesIO
              buffer = BytesIO()
              plt.savefig(buffer, format='png')
              plt.close()
              
              # Convert to base64
              buffer.seek(0)
              img_str = base64.b64encode(buffer.read()).decode('utf-8')
              
              overview["content"].append({
                  "type": "chart",
                  "title": "Log Distribution by Hour",
                  "image_data": img_str
              })
      
      # Add overview section to report
      report["sections"].append(overview)
      
      # Error Analysis Section
      if ${JSON.stringify(focusAreas.errors !== false)}:
          error_section = {
              "title": "Error Analysis",
              "content": []
          }
          
          # Filter error logs
          error_logs = []
          if 'level' in df.columns:
              error_logs = df[df['level'].str.upper().isin(['ERROR', 'SEVERE', 'FATAL', 'CRITICAL'])].to_dict('records')
          
          error_section["content"].append({
              "type": "text",
              "content": f"Total errors: {len(error_logs)}"
          })
          
          if len(error_logs) > 0:
              # Extract common error patterns
              error_messages = []
              exception_types = []
              
              for log in error_logs:
                  message = log.get("message", "")
                  if message:
                      # Look for exception type
                      exception_match = re.search(r'([A-Za-z0-9_.]+Exception|[A-Za-z0-9_.]+Error)', message)
                      if exception_match:
                          exception_types.append(exception_match.group(1))
              
              # Count exception types
              exception_counts = Counter(exception_types)
              
              if exception_counts:
                  error_section["content"].append({
                      "type": "text",
                      "content": "Common Exception Types:"
                  })
                  
                  exception_table = {
                      "type": "table",
                      "headers": ["Exception Type", "Count"],
                      "rows": []
                  }
                  
                  for exc_type, count in exception_counts.most_common(10):
                      exception_table["rows"].append([exc_type, str(count)])
                  
                  error_section["content"].append(exception_table)
                  
                  # Add exception type chart
                  if ${includeCharts}:
                      plt.figure(figsize=(10, 6))
                      exc_df = pd.DataFrame(list(exception_counts.items()), columns=['Exception', 'Count'])
                      exc_df = exc_df.sort_values('Count', ascending=False).head(10)  # Top 10 exceptions
                      
                      sns.barplot(x='Count', y='Exception', data=exc_df)
                      plt.title('Top 10 Exception Types')
                      plt.tight_layout()
                      
                      # Save to BytesIO
                      buffer = BytesIO()
                      plt.savefig(buffer, format='png')
                      plt.close()
                      
                      # Convert to base64
                      buffer.seek(0)
                      img_str = base64.b64encode(buffer.read()).decode('utf-8')
                      
                      error_section["content"].append({
                          "type": "chart",
                          "title": "Exception Type Distribution",
                          "image_data": img_str
                      })
              
              # Service error distribution
              if 'service' in df.columns:
                  service_error_counts = {}
                  for log in error_logs:
                      service = log.get("service")
                      if service:
                          service_error_counts[service] = service_error_counts.get(service, 0) + 1
                  
                  if service_error_counts:
                      error_section["content"].append({
                          "type": "text",
                          "content": "Services with Most Errors:"
                      })
                      
                      service_table = {
                          "type": "table",
                          "headers": ["Service", "Error Count"],
                          "rows": []
                      }
                      
                      for service, count in sorted(service_error_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
                          service_table["rows"].append([service, str(count)])
                      
                      error_section["content"].append(service_table)
              
              # Sample error logs
              error_section["content"].append({
                  "type": "text",
                  "content": "Sample Error Logs:"
              })
              
              for i, log in enumerate(error_logs[:5]):  # Show first 5 error logs
                  error_section["content"].append({
                      "type": "code",
                      "content": json.dumps(log, indent=2)
                  })
                  
                  if i < len(error_logs) - 1:
                      error_section["content"].append({"type": "separator"})
          
          # Add error section to report
          report["sections"].append(error_section)
      
      # Performance Analysis Section
      if ${JSON.stringify(focusAreas.performance !== false)}:
          performance_section = {
              "title": "Performance Analysis",
              "content": []
          }
          
          # Extract performance metrics
          response_times = []
          db_query_times = []
          
          for log in logs:
              message = log.get("message", "")
              if not message or not isinstance(message, str):
                  continue
                  
              # Look for response time
              response_time_match = re.search(r'(?:response time|took|elapsed|duration)\s*[=:]\s*(\d+(?:\.\d+)?)', message, re.IGNORECASE)
              if response_time_match:
                  try:
                      response_times.append(float(response_time_match.group(1)))
                  except:
                      pass
              
              # Look for DB query time
              db_time_match = re.search(r'(?:query|sql|db)\s*(?:time|took|elapsed|duration)\s*[=:]\s*(\d+(?:\.\d+)?)', message, re.IGNORECASE)
              if db_time_match:
                  try:
                      db_query_times.append(float(db_time_match.group(1)))
                  except:
                      pass
          
          # Add performance metrics
          if response_times:
              performance_section["content"].append({
                  "type": "text",
                  "content": f"Response Time Metrics:\n- Count: {len(response_times)}\n- Min: {min(response_times):.2f}ms\n- Max: {max(response_times):.2f}ms\n- Avg: {sum(response_times)/len(response_times):.2f}ms\n- 95th percentile: {np.percentile(response_times, 95):.2f}ms"
              })
              
              # Add response time histogram
              if ${includeCharts}:
                  plt.figure(figsize=(10, 6))
                  
                  # Plot histogram
                  sns.histplot(response_times, kde=True)
                  plt.title('Response Time Distribution')
                  plt.xlabel('Response Time (ms)')
                  plt.ylabel('Frequency')
                  plt.grid(linestyle='--', alpha=0.7)
                  
                  # Save to BytesIO
                  buffer = BytesIO()
                  plt.savefig(buffer, format='png')
                  plt.close()
                  
                  # Convert to base64
                  buffer.seek(0)
                  img_str = base64.b64encode(buffer.read()).decode('utf-8')
                  
                  performance_section["content"].append({
                      "type": "chart",
                      "title": "Response Time Distribution",
                      "image_data": img_str
                  })
          
          if db_query_times:
              performance_section["content"].append({
                  "type": "text",
                  "content": f"Database Query Time Metrics:\n- Count: {len(db_query_times)}\n- Min: {min(db_query_times):.2f}ms\n- Max: {max(db_query_times):.2f}ms\n- Avg: {sum(db_query_times)/len(db_query_times):.2f}ms\n- 95th percentile: {np.percentile(db_query_times, 95):.2f}ms"
              })
              
              # Add DB query time histogram
              if ${includeCharts}:
                  plt.figure(figsize=(10, 6))
                  
                  # Plot histogram
                  sns.histplot(db_query_times, kde=True)
                  plt.title('Database Query Time Distribution')
                  plt.xlabel('Query Time (ms)')
                  plt.ylabel('Frequency')
                  plt.grid(linestyle='--', alpha=0.7)
                  
                  # Save to BytesIO
                  buffer = BytesIO()
                  plt.savefig(buffer, format='png')
                  plt.close()
                  
                  # Convert to base64
                  buffer.seek(0)
                  img_str = base64.b64encode(buffer.read()).decode('utf-8')
                  
                  performance_section["content"].append({
                      "type": "chart",
                      "title": "Database Query Time Distribution",
                      "image_data": img_str
                  })
          
          # Add performance section to report
          report["sections"].append(performance_section)
      
      # Trace Analysis Section
      if ${JSON.stringify(focusAreas.traces !== false)}:
          trace_section = {
              "title": "Distributed Trace Analysis",
              "content": []
          }
          
          # Group logs by trace ID
          trace_groups = defaultdict(list)
          for log in logs:
              trace_id = log.get("traceId")
              if trace_id:
                  trace_groups[trace_id].append(log)
          
          trace_section["content"].append({
              "type": "text",
              "content": f"Total traces: {len(trace_groups)}"
          })
          
          if trace_groups:
              # Calculate trace statistics
              trace_sizes = {trace_id: len(logs) for trace_id, logs in trace_groups.items()}
              trace_services = {trace_id: len(set(log.get("service") for log in logs if log.get("service"))) for trace_id, logs in trace_groups.items()}
              
              # Calculate trace durations
              trace_durations = {}
              for trace_id, logs in trace_groups.items():
                  timestamps = []
                  for log in logs:
                      timestamp = log.get("timestamp")
                      if timestamp:
                          ts = parse_timestamp(timestamp)
                          if ts:
                              timestamps.append(ts)
                  
                  if len(timestamps) >= 2:
                      min_ts = min(timestamps)
                      max_ts = max(timestamps)
                      duration_ms = (max_ts - min_ts).total_seconds() * 1000
                      trace_durations[trace_id] = duration_ms
              
              # Add trace statistics
              trace_section["content"].append({
                  "type": "text",
                  "content": f"Trace Statistics:\n- Average logs per trace: {sum(trace_sizes.values())/len(trace_sizes):.2f}\n- Average services per trace: {sum(trace_services.values())/len(trace_services):.2f}\n- Average trace duration: {sum(trace_durations.values())/len(trace_durations):.2f}ms (for {len(trace_durations)} traces with duration data)"
              })
              
              # Add trace duration histogram
              if ${includeCharts} and trace_durations:
                  plt.figure(figsize=(10, 6))
                  
                  # Plot histogram
                  sns.histplot(list(trace_durations.values()), kde=True)
                  plt.title('Trace Duration Distribution')
                  plt.xlabel('Duration (ms)')
                  plt.ylabel('Frequency')
                  plt.grid(linestyle='--', alpha=0.7)
                  
                  # Save to BytesIO
                  buffer = BytesIO()
                  plt.savefig(buffer, format='png')
                  plt.close()
                  
                  # Convert to base64
                  buffer.seek(0)
                  img_str = base64.b64encode(buffer.read()).decode('utf-8')
                  
                  trace_section["content"].append({
                      "type": "chart",
                      "title": "Trace Duration Distribution",
                      "image_data": img_str
                  })
              
              # Service interaction graph
              if ${includeCharts}:
                  # Create service interaction graph
                  G = nx.DiGraph()
                  
                  # Track service interactions
                  service_interactions = defaultdict(int)
                  
                  for trace_id, logs in trace_groups.items():
                      # Group logs by service
                      service_logs = defaultdict(list)
                      for log in logs:
                          service = log.get("service")
                          if service:
                              service_logs[service].append(log)
                      
                      # Add nodes for each service
                      for service in service_logs.keys():
                          if service not in G.nodes():
                              G.add_node(service)
                      
                      # Add edges for service interactions based on trace and span relationships
                      for log in logs:
                          service = log.get("service")
                          span_id = log.get("spanId")
                          parent_span_id = log.get("parentSpanId")
                          
                          if service and span_id and parent_span_id:
                              # Find parent service
                              parent_service = None
                              for parent_log in logs:
                                  if parent_log.get("spanId") == parent_span_id:
                                      parent_service = parent_log.get("service")
                                      break
                              
                              if parent_service and parent_service != service:
                                  service_interactions[(parent_service, service)] += 1
                  
                  # Add edges to graph
                  for (source, target), weight in service_interactions.items():
                      G.add_edge(source, target, weight=weight)
                  
                  if G.number_of_edges() > 0:
                      plt.figure(figsize=(12, 10))
                      
                      # Create positions for nodes
                      pos = nx.spring_layout(G, seed=42)
                      
                      # Draw nodes
                      nx.draw_networkx_nodes(G, pos, node_color='lightblue', node_size=500, alpha=0.8)
                      nx.draw_networkx_labels(G, pos, font_size=10)
                      
                      # Draw edges with width proportional to weight
                      edge_widths = [G[u][v]['weight'] / max(service_interactions.values()) * 5 for u, v in G.edges()]
                      nx.draw_networkx_edges(G, pos, width=edge_widths, alpha=0.5, edge_color='gray', arrows=True, arrowsize=15)
                      
                      # Add edge labels showing count of interactions
                      edge_labels = {(u, v): f"{G[u][v]['weight']}" for u, v in G.edges()}
                      nx.draw_networkx_edge_labels(G, pos, edge_labels=edge_labels, font_size=8)
                      
                      plt.title("Service Interaction Graph")
                      plt.axis('off')
                      
                      # Save to BytesIO
                      buffer = BytesIO()
                      plt.savefig(buffer, format='png')
                      plt.close()
                      
                      # Convert to base64
                      buffer.seek(0)
                      img_str = base64.b64encode(buffer.read()).decode('utf-8')
                      
                      trace_section["content"].append({
                          "type": "chart",
                          "title": "Service Interaction Graph",
                          "image_data": img_str
                      })
              
              # Top traces by size
              trace_section["content"].append({
                  "type": "text",
                  "content": "Largest Traces:"
              })
              
              trace_table = {
                  "type": "table",
                  "headers": ["Trace ID", "Log Count", "Services", "Duration (ms)"],
                  "rows": []
              }
              
              for trace_id, count in sorted(trace_sizes.items(), key=lambda x: x[1], reverse=True)[:10]:
                  services = len(set(log.get("service") for log in trace_groups[trace_id] if log.get("service")))
                  duration = f"{trace_durations.get(trace_id, 'N/A'):.2f}" if trace_id in trace_durations else "N/A"
                  
                  trace_table["rows"].append([trace_id, str(count), str(services), duration])
              
              trace_section["content"].append(trace_table)
          
          # Add trace section to report
          report["sections"].append(trace_section)
      
      # Anomaly Detection Section
      if ${JSON.stringify(focusAreas.anomalies !== false)}:
          anomaly_section = {
              "title": "Anomaly Detection",
              "content": []
          }
          
          # Perform anomaly detection
          try:
              # Prepare features for anomaly detection
              features = []
              feature_names = []
              
              # Use numeric columns if available
              numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
              
              if numeric_cols:
                  # Use existing numeric features
                  features = df[numeric_cols].fillna(0).values
                  feature_names = numeric_cols
              else:
                  # Create simple features
                  if 'level' in df.columns:
                      df['is_error'] = df['level'].str.upper().isin(['ERROR', 'SEVERE', 'FATAL', 'CRITICAL']).astype(int)
                      df['is_warning'] = df['level'].str.upper().isin(['WARNING', 'WARN']).astype(int)
                      features = df[['is_error', 'is_warning']].values
                      feature_names = ['is_error', 'is_warning']
                  elif 'message' in df.columns:
                      # Use message length as a feature
                      df['message_length'] = df['message'].str.len()
                      features = df[['message_length']].values
                      feature_names = ['message_length']
              
              if len(features) > 0 and len(features[0]) > 0:
                  # Apply Isolation Forest
                  model = IsolationForest(contamination=0.05, random_state=42)
                  df['anomaly'] = model.fit_predict(features)
                  df['anomaly_score'] = model.decision_function(features)
                  
                  # Count anomalies
                  anomaly_count = (df['anomaly'] == -1).sum()
                  
                  anomaly_section["content"].append({
                      "type": "text",
                      "content": f"Anomaly Detection Results:\n- Total anomalies detected: {anomaly_count} ({anomaly_count/len(df)*100:.2f}% of logs)\n- Features used: {', '.join(feature_names)}"
                  })
                  
                  if anomaly_count > 0:
                      # Add anomaly score distribution
                      if ${includeCharts}:
                          plt.figure(figsize=(10, 6))
                          
                          # Plot histogram of anomaly scores
                          sns.histplot(df['anomaly_score'], kde=True)
                          plt.axvline(x=0, color='r', linestyle='--')
                          plt.title('Anomaly Score Distribution')
                          plt.xlabel('Anomaly Score (negative = anomaly)')
                          plt.ylabel('Frequency')
                          plt.grid(linestyle='--', alpha=0.7)
                          
                          # Save to BytesIO
                          buffer = BytesIO()
                          plt.savefig(buffer, format='png')
                          plt.close()
                          
                          # Convert to base64
                          buffer.seek(0)
                          img_str = base64.b64encode(buffer.read()).decode('utf-8')
                          
                          anomaly_section["content"].append({
                              "type": "chart",
                              "title": "Anomaly Score Distribution",
                              "image_data": img_str
                          })
                      
                      # Sample anomalies
                      anomaly_section["content"].append({
                          "type": "text",
                          "content": "Sample Anomalies:"
                      })
                      
                      anomaly_logs = df[df['anomaly'] == -1].sort_values('anomaly_score').head(5).to_dict('records')
                      
                      for i, log in enumerate(anomaly_logs):
                          # Clean up log for display
                          display_log = {k: v for k, v in log.items() if k not in ['anomaly', 'anomaly_score', 'parsed_timestamp'] and not pd.isna(v)}
                          
                          anomaly_section["content"].append({
                              "type": "code",
                              "content": json.dumps(display_log, indent=2)
                          })
                          
                          if i < len(anomaly_logs) - 1:
                              anomaly_section["content"].append({"type": "separator"})
          except Exception as e:
              anomaly_section["content"].append({
                  "type": "text",
                  "content": f"Error performing anomaly detection: {str(e)}"
              })
          
          # Add anomaly section to report
          report["sections"].append(anomaly_section)
      
      # Create output directory if it doesn't exist
      os.makedirs(os.path.dirname(${JSON.stringify(outputPath)}), exist_ok=True)
      
      # Generate report in the requested format
      if ${JSON.stringify(reportFormat)} == "json":
          # Save as JSON
          with open(${JSON.stringify(outputPath)}, 'w', encoding='utf-8') as f:
              json.dump(report, f, indent=2, default=str)
      
      elif ${JSON.stringify(reportFormat)} == "markdown":
          # Generate markdown
          markdown = f"# {report['title']}\n\n"
          markdown += f"Generated: {report['generated_at']}\n\n"
          markdown += f"Logs analyzed: {report['log_count']}\n\n"
          
          if report['time_period']['start'] and report['time_period']['end']:
              markdown += f"Time period: {report['time_period']['start']} to {report['time_period']['end']}\n\n"
          
          # Add sections
          for section in report['sections']:
              markdown += f"## {section['title']}\n\n"
              
              for item in section['content']:
                  if item['type'] == 'text':
                      markdown += f"{item['content']}\n\n"
                  
                  elif item['type'] == 'table':
                      # Create markdown table
                      markdown += f"| {' | '.join(item['headers'])} |\n"
                      markdown += f"| {' | '.join(['---' for _ in item['headers']])} |\n"
                      
                      for row in item['rows']:
                          markdown += "| " + row.join(" | ") + " |\n"
                      
                      markdown += "\n"
                      
                  else if (item['type'] == 'code') {
                      markdown += "```json\n" + item['content'] + "\n```\n\n";
                  }
                  
                  else if (item['type'] == 'chart' && 'image_data' in item) {
                      // For markdown, we'll just mention that charts are available in HTML version
                      markdown += "*[Chart: " + item['title'] + "]*\n\n";
                  }
                  
                  elif item['type'] == 'separator':
                      markdown += "---\n\n"
                  elif item['type'] == 'separator':
                      markdown += "---\n\n"
          
          # Save markdown
          with open(${JSON.stringify(outputPath)}, 'w', encoding='utf-8') as f:
              f.write(markdown)
      
      else:  # HTML
          # Generate HTML
          html = f"""<!DOCTYPE html>
  <html>
  <head>
      <title>{report['title']}</title>
      <style>
          body {{ font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; color: #333; }}
          h1 {{ color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }}
          h2 {{ color: #2980b9; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 30px; }}
          .container {{ max-width: 1200px; margin: 0 auto; }}
          .metadata {{ color: #7f8c8d; font-size: 0.9em; margin-bottom: 20px; }}
          .chart {{ margin: 20px 0; text-align: center; }}
          .chart img {{ max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }}
          table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
          th, td {{ text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }}
          th {{ background-color: #f2f2f2; }}
          tr:hover {{ background-color: #f5f5f5; }}
          pre {{ background-color: #f8f8f8; border: 1px solid #ddd; border-radius: 4px; padding: 15px; overflow-x: auto; }}
          .separator {{ height: 1px; background-color: #ddd; margin: 20px 0; }}
      </style>
  </head>
  <body>
      <div class="container">
          <h1>{report['title']}</h1>
          <div class="metadata">
              <p>Generated: {report['generated_at']}</p>
              <p>Logs analyzed: {report['log_count']}</p>
  """
          
          if report['time_period']['start'] and report['time_period']['end']:
              html += f"<p>Time period: {report['time_period']['start']} to {report['time_period']['end']}</p>\n"
          
          html += "</div>\n"
          
          # Add sections
          for section in report['sections']:
              html += f"<h2>{section['title']}</h2>\n"
              
              for item in section['content']:
                  if item['type'] == 'text':
                      html += f"<p>{item['content'].replace('\n', '<br>')}</p>\n"
                  
                  elif item['type'] == 'table':
                      html += "<table>\n<thead>\n<tr>\n"
                      for header in item['headers']:
                          html += f"<th>{header}</th>\n"
                      html += "</tr>\n</thead>\n<tbody>\n"
                      
                      for row in item['rows']:
                          html += "<tr>\n"
                          for cell in row:
                              html += f"<td>{cell}</td>\n"
                          html += "</tr>\n"
                      
                      html += "</tbody>\n</table>\n"
                  
                  elif item['type'] == 'code':
                      html += f"<pre>{item['content']}</pre>\n"
                  
                  elif item['type'] == 'chart' and 'image_data' in item:
                      html += f"<div class=\"chart\">\n"
                      html += f"<h3>{item['title']}</h3>\n"
                      html += f"<img src=\"data:image/png;base64,{item['image_data']}\" alt=\"{item['title']}\">\n"
                      html += "</div>\n"
                  
                  elif item['type'] == 'separator':
                      html += "<div class=\"separator\"></div>\n"
          
          html += """    </div>
  </body>
  </html>"""
          
          # Save HTML
          with open(${JSON.stringify(outputPath)}, 'w', encoding='utf-8') as f:
              f.write(html)
      
      # Generate summary
      summary = {
          "report_title": report["title"],
          "logs_analyzed": report["log_count"],
          "sections": [section["title"] for section in report["sections"]],
          "output_path": ${JSON.stringify(outputPath)},
          "format": ${JSON.stringify(reportFormat)}
      }
      
      if report['time_period']['start'] and report['time_period']['end']:
          summary["time_period"] = {
              "start": report['time_period']['start'],
              "end": report['time_period']['end']
          }
      
      # Add chart count
      chart_count = sum(1 for section in report["sections"] for item in section["content"] if item["type"] == "chart" and "image_data" in item)
      summary["chart_count"] = chart_count
      
      print(json.dumps(summary))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error generating log analysis report: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Log Analysis Report Generated:\n\n`;
        responseText += `- Title: ${result.report_title}\n`;
        responseText += `- Logs analyzed: ${result.logs_analyzed}\n`;
        
        if (result.time_period) {
          responseText += `- Time period: ${result.time_period.start} to ${result.time_period.end}\n`;
        }
        
        responseText += `- Format: ${result.format}\n`;
        responseText += `- Output saved to: ${result.output_path}\n\n`;
        
        responseText += `Report sections:\n`;
        for (const section of result.sections) {
          responseText += `- ${section}\n`;
        }
        
        if (includeCharts && result.chart_count > 0) {
          responseText += `\nThe report includes ${result.chart_count} charts and visualizations.`;
        }
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing report generation results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in generate_log_analysis_report tool:', error);
      return {
        content: [{ type: 'text', text: `Error generating log analysis report: ${error.message}` }],
        isError: true
      };
    }
  });