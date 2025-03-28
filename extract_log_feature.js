this.server.tool('extract_log_features', z.object({
    processedLogPath: z.string().describe('Path to the processed log data JSON file'),
    outputPath: z.string().describe('Path to save the extracted features'),
    featureConfig: z.object({
      includeTimestampPatterns: z.boolean().optional().describe('Extract time-based patterns (default: true)'),
      includeErrorPatterns: z.boolean().optional().describe('Extract error patterns and stack traces (default: true)'),
      includePerformanceMetrics: z.boolean().optional().describe('Extract performance metrics (default: true)'),
      includeTraceAnalysis: z.boolean().optional().describe('Analyze trace and span relationships (default: true)')
    }).optional().describe('Configuration for feature extraction')
  }).shape, async (params) => {
    /** Extract features from processed log data for training machine learning models */
    try {
      const {
        processedLogPath,
        outputPath,
        featureConfig = {
          includeTimestampPatterns: true,
          includeErrorPatterns: true,
          includePerformanceMetrics: true,
          includeTraceAnalysis: true
        }
      } = params;
      
      const config = {
        includeTimestampPatterns: featureConfig.includeTimestampPatterns !== false,
        includeErrorPatterns: featureConfig.includeErrorPatterns !== false,
        includePerformanceMetrics: featureConfig.includePerformanceMetrics !== false,
        includeTraceAnalysis: featureConfig.includeTraceAnalysis !== false
      };
      
      const script = `
  import json
  import os
  import re
  import pandas as pd
  import numpy as np
  from datetime import datetime
  import pytz
  from collections import defaultdict, Counter
  
  try:
      # Load processed log data
      with open(${JSON.stringify(processedLogPath)}, 'r', encoding='utf-8') as f:
          logs = json.load(f)
      
      # Convert to DataFrame for easier processing
      df = pd.DataFrame(logs)
      
      # Initialize feature dictionary
      features = {
          "log_entries": [],
          "global_stats": {},
          "service_stats": {},
          "trace_stats": {},
          "error_patterns": [],
          "performance_metrics": []
      }
      
      # Global statistics
      features["global_stats"] = {
          "total_logs": len(logs),
          "unique_services": df["service"].nunique() if "service" in df.columns else 0,
          "log_levels": df["level"].value_counts().to_dict() if "level" in df.columns else {}
      }
      
      # Extract timestamp patterns if requested
      if ${config.includeTimestampPatterns}:
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
          
          # Find timestamp field
          timestamp_field = None
          for field in ['timestamp', 'time', 'date', '@timestamp']:
              if field in df.columns:
                  timestamp_field = field
                  break
          
          if timestamp_field:
              # Parse timestamps
              timestamps = [parse_timestamp(ts) for ts in df[timestamp_field] if ts]
              valid_timestamps = [ts for ts in timestamps if ts is not None]
              
              if valid_timestamps:
                  # Extract time-based features
                  hour_distribution = Counter([ts.hour for ts in valid_timestamps])
                  weekday_distribution = Counter([ts.weekday() for ts in valid_timestamps])
                  
                  # Add to features
                  features["timestamp_patterns"] = {
                      "hour_distribution": {str(h): count for h, count in hour_distribution.items()},
                      "weekday_distribution": {str(d): count for d, count in weekday_distribution.items()},
                      "min_timestamp": min(valid_timestamps).isoformat(),
                      "max_timestamp": max(valid_timestamps).isoformat()
                  }
      
      # Extract error patterns if requested
      if ${config.includeErrorPatterns}:
          # Find error logs
          error_logs = []
          if "level" in df.columns:
              error_logs = df[df["level"].str.upper().isin(["ERROR", "SEVERE", "FATAL", "CRITICAL"])].to_dict('records') if not df.empty else []
          
          # Extract common error patterns
          error_messages = []
          exception_types = []
          stack_traces = []
          
          for log in error_logs:
              # Extract message
              message = log.get("message", "")
              if message:
                  error_messages.append(message)
                  
                  # Look for exception type
                  exception_match = re.search(r'([A-Za-z0-9_.]+Exception|[A-Za-z0-9_.]+Error)', message)
                  if exception_match:
                      exception_types.append(exception_match.group(1))
                  
                  # Look for stack trace
                  if "\n" in message and ("at " in message or "Caused by:" in message):
                      stack_traces.append(message)
          
          # Count common error types
          error_type_counts = Counter(exception_types)
          
          # Extract common patterns from stack traces
          common_frames = []
          for trace in stack_traces:
              frames = re.findall(r'\s+at\s+([^\n]+)', trace)
              common_frames.extend(frames)
          
          common_frame_counts = Counter(common_frames).most_common(20)
          
          # Add to features
          features["error_patterns"] = {
              "total_errors": len(error_logs),
              "error_types": {k: v for k, v in error_type_counts.most_common(10)},
              "common_stack_frames": {frame: count for frame, count in common_frame_counts}
          }
      
      # Extract performance metrics if requested
      if ${config.includePerformanceMetrics}:
          # Look for common performance indicators
          perf_metrics = {
              "response_times": [],
              "memory_usage": [],
              "cpu_usage": [],
              "db_query_times": []
          }
          
          # Regular expressions for common performance metrics
          patterns = {
              "response_time": r'(?:response time|took|elapsed|duration)\s*[=:]\s*(\d+(?:\.\d+)?)',
              "memory": r'(?:memory|heap|ram)\s*[=:]\s*(\d+(?:\.\d+)?)',
              "cpu": r'(?:cpu|processor)\s*[=:]\s*(\d+(?:\.\d+)?)',
              "db_query": r'(?:query|sql|db)\s*(?:time|took|elapsed|duration)\s*[=:]\s*(\d+(?:\.\d+)?)'
          }
          
          for log in logs:
              message = log.get("message", "")
              if not message or not isinstance(message, str):
                  continue
                  
              # Check for response time
              match = re.search(patterns["response_time"], message, re.IGNORECASE)
              if match:
                  try:
                      perf_metrics["response_times"].append(float(match.group(1)))
                  except:
                      pass
              
              # Check for memory usage
              match = re.search(patterns["memory"], message, re.IGNORECASE)
              if match:
                  try:
                      perf_metrics["memory_usage"].append(float(match.group(1)))
                  except:
                      pass
              
              # Check for CPU usage
              match = re.search(patterns["cpu"], message, re.IGNORECASE)
              if match:
                  try:
                      perf_metrics["cpu_usage"].append(float(match.group(1)))
                  except:
                      pass
              
              # Check for DB query time
              match = re.search(patterns["db_query"], message, re.IGNORECASE)
              if match:
                  try:
                      perf_metrics["db_query_times"].append(float(match.group(1)))
                  except:
                      pass
          
          # Calculate statistics for each metric
          performance_stats = {}
          for metric, values in perf_metrics.items():
              if values:
                  performance_stats[metric] = {
                      "count": len(values),
                      "min": min(values),
                      "max": max(values),
                      "mean": sum(values) / len(values),
                      "p95": np.percentile(values, 95) if len(values) >= 20 else None,
                      "p99": np.percentile(values, 99) if len(values) >= 100 else None
                  }
          
          # Add to features
          features["performance_metrics"] = performance_stats
      
      # Analyze trace and span relationships if requested
      if ${config.includeTraceAnalysis}:
          # Check if trace data exists
          has_trace_data = "traceId" in df.columns
          
          if has_trace_data:
              # Group by trace ID
              trace_groups = df.groupby("traceId") if not df.empty else []
              
              trace_stats = {
                  "total_traces": len(trace_groups),
                  "trace_sizes": {},
                  "service_interactions": {},
                  "trace_durations": {}
              }
              
              # Analyze each trace
              for trace_id, trace_df in trace_groups:
                  if trace_id is None or pd.isna(trace_id):
                      continue
                      
                  # Count logs in trace
                  trace_size = len(trace_df)
                  trace_stats["trace_sizes"][trace_id] = trace_size
                  
                  # Analyze services in trace
                  if "service" in trace_df.columns:
                      services = trace_df["service"].dropna().unique().tolist()
                      
                      # Record service interactions
                      if len(services) > 1:
                          for i in range(len(services)):
                              for j in range(i+1, len(services)):
                                  pair = tuple(sorted([services[i], services[j]]))
                                  if pair not in trace_stats["service_interactions"]:
                                      trace_stats["service_interactions"][str(pair)] = 0
                                  trace_stats["service_interactions"][str(pair)] += 1
                  
                  # Calculate trace duration if timestamps exist
                  timestamp_field = None
                  for field in ['timestamp', 'time', 'date', '@timestamp']:
                      if field in trace_df.columns:
                          timestamp_field = field
                          break
                          
                  if timestamp_field:
                      # Parse timestamps
                      timestamps = [parse_timestamp(ts) for ts in trace_df[timestamp_field] if ts]
                      valid_timestamps = [ts for ts in timestamps if ts is not None]
                      
                      if len(valid_timestamps) >= 2:
                          min_ts = min(valid_timestamps)
                          max_ts = max(valid_timestamps)
                          duration_ms = (max_ts - min_ts).total_seconds() * 1000
                          trace_stats["trace_durations"][trace_id] = duration_ms
              
              # Calculate trace duration statistics
              durations = list(trace_stats["trace_durations"].values())
              if durations:
                  trace_stats["duration_stats"] = {
                      "min_ms": min(durations),
                      "max_ms": max(durations),
                      "mean_ms": sum(durations) / len(durations),
                      "p95_ms": np.percentile(durations, 95) if len(durations) >= 20 else None
                  }
              
              # Limit the number of individual trace entries to avoid huge output
              trace_stats["trace_sizes"] = {k: v for k, v in list(trace_stats["trace_sizes"].items())[:100]}
              trace_stats["trace_durations"] = {k: v for k, v in list(trace_stats["trace_durations"].items())[:100]}
              
              # Add to features
              features["trace_stats"] = trace_stats
      
      # Process individual log entries to create feature vectors
      for log in logs:
          # Basic log features
          log_features = {
              "_id": log.get("_trace_index", logs.index(log)),
              "_source_file": log.get("_source_file", "unknown")
          }
          
          # Add service info
          if "service" in log:
              log_features["service"] = log["service"]
          
          # Add level info
          if "level" in log:
              log_features["level"] = log["level"]
              log_features["is_error"] = 1 if log["level"].upper() in ["ERROR", "SEVERE", "FATAL", "CRITICAL"] else 0
          
          # Add trace info
          if "traceId" in log:
              log_features["traceId"] = log["traceId"]
              log_features["spanId"] = log.get("spanId")
              log_features["parentSpanId"] = log.get("parentSpanId")
              
              # Add trace structure info if available
              if "_trace_structure" in log:
                  trace_structure = log["_trace_structure"]
                  log_features["trace_total_spans"] = trace_structure.get("total_spans")
                  log_features["trace_total_logs"] = trace_structure.get("total_logs")
                  log_features["is_root_span"] = 1 if log.get("spanId") in trace_structure.get("root_spans", []) else 0
          
          # Extract timestamp features if available
          timestamp_field = None
          for field in ['timestamp', 'time', 'date', '@timestamp']:
              if field in log:
                  timestamp_field = field
                  log_features["timestamp"] = log[field]
                  
                  # Parse timestamp
                  ts = parse_timestamp(log[field])
                  if ts:
                      log_features["hour"] = ts.hour
                      log_features["minute"] = ts.minute
                      log_features["weekday"] = ts.weekday()
                      log_features["is_business_hours"] = 1 if 9 <= ts.hour <= 17 else 0
                      log_features["is_weekend"] = 1 if ts.weekday() >= 5 else 0
                  break
          
          # Extract message features
          if "message" in log and isinstance(log["message"], str):
              message = log["message"]
              
              # Message length
              log_features["message_length"] = len(message)
              log_features["message_line_count"] = message.count("\n") + 1
              
              # Check for common patterns
              log_features["has_exception"] = 1 if re.search(r'exception|error|failure|failed', message, re.IGNORECASE) else 0
              log_features["has_stack_trace"] = 1 if "\n" in message and ("at " in message or "Caused by:" in message) else 0
              log_features["has_ip_address"] = 1 if re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', message) else 0
              log_features["has_url"] = 1 if re.search(r'https?://\S+', message) else 0
              
              # Performance indicators
              response_time_match = re.search(r'(?:response time|took|elapsed|duration)\s*[=:]\s*(\d+(?:\.\d+)?)', message, re.IGNORECASE)
              if response_time_match:
                  try:
                      log_features["response_time"] = float(response_time_match.group(1))
                  except:
                      pass
          
          # Add to feature list
          features["log_entries"].append(log_features)
      
      # Create output directory if it doesn't exist
      os.makedirs(os.path.dirname(${JSON.stringify(outputPath)}), exist_ok=True)
      
      # Save features
      with open(${JSON.stringify(outputPath)}, 'w', encoding='utf-8') as f:
          json.dump(features, f, indent=2)
      
      # Generate summary
      summary = {
          "total_logs_processed": len(logs),
          "features_extracted": len(features["log_entries"]),
          "output_path": ${JSON.stringify(outputPath)},
          "feature_categories": []
      }
      
      # Add feature categories
      if ${config.includeTimestampPatterns} and "timestamp_patterns" in features:
          summary["feature_categories"].append("timestamp_patterns")
      
      if ${config.includeErrorPatterns} and "error_patterns" in features:
          summary["feature_categories"].append("error_patterns")
          summary["error_count"] = features["error_patterns"].get("total_errors", 0)
      
      if ${config.includePerformanceMetrics} and "performance_metrics" in features:
          summary["feature_categories"].append("performance_metrics")
          perf_metrics = features["performance_metrics"]
          if "response_times" in perf_metrics:
              summary["response_time_count"] = perf_metrics["response_times"].get("count", 0)
      
      if ${config.includeTraceAnalysis} and "trace_stats" in features:
          summary["feature_categories"].append("trace_analysis")
          summary["trace_count"] = features["trace_stats"].get("total_traces", 0)
      
      print(json.dumps(summary))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error extracting log features: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Successfully extracted log features:\n\n`;
        responseText += `- Total logs processed: ${result.total_logs_processed}\n`;
        responseText += `- Features extracted: ${result.features_extracted}\n`;
        responseText += `- Output saved to: ${result.output_path}\n\n`;
        
        responseText += `Feature categories included:\n`;
        for (const category of result.feature_categories) {
          responseText += `- ${category}\n`;
          
          // Add category-specific details
          if (category === 'error_patterns' && result.error_count !== undefined) {
            responseText += `  • ${result.error_count} errors identified\n`;
          } else if (category === 'trace_analysis' && result.trace_count !== undefined) {
            responseText += `  • ${result.trace_count} unique traces analyzed\n`;
          } else if (category === 'performance_metrics' && result.response_time_count !== undefined) {
            responseText += `  • ${result.response_time_count} response time measurements extracted\n`;
          }
        }
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing feature extraction results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in extract_log_features tool:', error);
      return {
        content: [{ type: 'text', text: `Error extracting log features: ${error.message}` }],
        isError: true
      };
    }
  });