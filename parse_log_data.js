this.server.tool('parse_log_data', z.object({
    logFiles: z.array(z.string()).describe('Array of paths to log files or directories containing logs'),
    logFormat: z.enum(['json', 'xml', 'text', 'auto']).optional().describe('Format of the log files (default: auto)'),
    outputPath: z.string().describe('Path to save the processed log data'),
    extractTracing: z.boolean().optional().describe('Whether to extract and correlate trace and span IDs (default: true)'),
    timeZone: z.string().optional().describe('Timezone to normalize timestamps to (default: UTC)')
  }).shape, async (params) => {
    /** Parse and normalize log data from various sources into a consistent format for analysis and training */
    try {
      const {
        logFiles,
        logFormat = 'auto',
        outputPath,
        extractTracing = true,
        timeZone = 'UTC'
      } = params;
      
      const script = `
  import json
  import os
  import glob
  import re
  import pandas as pd
  from datetime import datetime
  import pytz
  import xml.etree.ElementTree as ET
  
  try:
      # Function to detect log format if auto is selected
      def detect_format(file_path):
          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
              first_line = f.readline().strip()
              if first_line.startswith('{') and first_line.endswith('}'): 
                  return 'json'
              elif first_line.startswith('<'):
                  return 'xml'
              else:
                  return 'text'
      
      # Function to parse JSON logs
      def parse_json_logs(file_path):
          logs = []
          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
              for line in f:
                  try:
                      log_entry = json.loads(line.strip())
                      logs.append(log_entry)
                  except json.JSONDecodeError:
                      continue
          return logs
      
      # Function to parse XML logs
      def parse_xml_logs(file_path):
          logs = []
          try:
              tree = ET.parse(file_path)
              root = tree.getroot()
              for entry in root.findall('.//log') or root.findall('.//event') or root.findall('.//*'):
                  log_entry = {}
                  for child in entry:
                      log_entry[child.tag] = child.text
                  logs.append(log_entry)
          except ET.ParseError:
              # Handle case where file contains multiple XML documents
              with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                  content = f.read()
                  # Split by XML declaration or root tags
                  entries = re.split(r'<\?xml|<log>|<event>', content)
                  for entry in entries:
                      if not entry.strip():
                          continue
                      try:
                          # Add back the root tag if needed
                          if not entry.startswith('<'):
                              entry = '<log>' + entry
                          root = ET.fromstring(entry)
                          log_entry = {}
                          for child in root:
                              log_entry[child.tag] = child.text
                          logs.append(log_entry)
                      except ET.ParseError:
                          continue
          return logs
      
      # Function to parse text logs
      def parse_text_logs(file_path):
          logs = []
          
          # Common log patterns
          patterns = [
              # ISO timestamp with level, service, message
              r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)\s+(?:\[([^\]]+)\])?\s*(?:(\w+)\s+)?(?:\[([^\]]+)\])?\s*(?:\[([^\]]+)\])?\s*(.*)',
              # Simple timestamp with level and message
              r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(?:(\w+)\s+)?(?:\[([^\]]+)\])?\s*(.*)',
              # Log with thread and logger info
              r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(\w+)\s+(\S+)\s+(.*)',
              # Trace ID and Span ID pattern
              r'.*traceId[=:]\s*([a-zA-Z0-9-]+).*spanId[=:]\s*([a-zA-Z0-9-]+).*'
          ]
          
          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
              current_log = {}
              multiline_msg = []
              
              for line in f:
                  line = line.strip()
                  if not line:
                      continue
                  
                  matched = False
                  for pattern in patterns:
                      match = re.match(pattern, line)
                      if match:
                          # If we have a previous log entry with multiline message
                          if current_log and multiline_msg:
                              current_log['message'] = '\n'.join(multiline_msg)
                              logs.append(current_log)
                              multiline_msg = []
                          
                          # Create new log entry
                          current_log = {}
                          groups = match.groups()
                          
                          # Handle different patterns
                          if 'traceId' in pattern:
                              # Extract trace and span IDs
                              trace_match = re.search(r'traceId[=:]\s*([a-zA-Z0-9-]+)', line)
                              span_match = re.search(r'spanId[=:]\s*([a-zA-Z0-9-]+)', line)
                              parent_span_match = re.search(r'parentSpanId[=:]\s*([a-zA-Z0-9-]+)', line)
                              
                              if trace_match:
                                  current_log['traceId'] = trace_match.group(1)
                              if span_match:
                                  current_log['spanId'] = span_match.group(1)
                              if parent_span_match:
                                  current_log['parentSpanId'] = parent_span_match.group(1)
                                  
                              # Try to extract other fields
                              level_match = re.search(r'\b(ERROR|WARN|INFO|DEBUG|TRACE)\b', line)
                              if level_match:
                                  current_log['level'] = level_match.group(1)
                                  
                              # The rest is the message
                              multiline_msg = [line]
                          elif len(groups) >= 6:  # Log with thread and logger
                              current_log['timestamp'] = groups[0]
                              current_log['thread'] = groups[1]
                              current_log['logger'] = groups[2]
                              current_log['level'] = groups[3]
                              current_log['service'] = groups[4]
                              multiline_msg = [groups[5]]
                          elif len(groups) >= 4:  # ISO timestamp with level, service
                              current_log['timestamp'] = groups[0]
                              if groups[1]:
                                  current_log['service'] = groups[1]
                              if groups[2]:
                                  current_log['level'] = groups[2]
                              multiline_msg = [groups[-1]]
                          else:  # Simple timestamp
                              current_log['timestamp'] = groups[0]
                              if len(groups) > 1 and groups[1]:
                                  current_log['level'] = groups[1]
                              if len(groups) > 2 and groups[2]:
                                  current_log['service'] = groups[2]
                              multiline_msg = [groups[-1]]
                          
                          matched = True
                          break
                  
                  if not matched and current_log:
                      # This is a continuation of the previous log message
                      multiline_msg.append(line)
              
              # Don't forget the last log entry
              if current_log and multiline_msg:
                  current_log['message'] = '\n'.join(multiline_msg)
                  logs.append(current_log)
          
          return logs
      
      # Function to normalize timestamps
      def normalize_timestamps(logs, target_timezone):
          tz = pytz.timezone(target_timezone)
          timestamp_fields = ['timestamp', 'time', 'date', '@timestamp']
          
          for log in logs:
              for field in timestamp_fields:
                  if field in log and log[field]:
                      try:
                          # Handle various timestamp formats
                          formats = [
                              '%Y-%m-%dT%H:%M:%S.%fZ',
                              '%Y-%m-%dT%H:%M:%S.%f%z',
                              '%Y-%m-%dT%H:%M:%S%z',
                              '%Y-%m-%dT%H:%M:%SZ',
                              '%Y-%m-%d %H:%M:%S.%f',
                              '%Y-%m-%d %H:%M:%S'
                          ]
                          
                          dt = None
                          for fmt in formats:
                              try:
                                  if 'Z' in fmt and 'Z' not in log[field]:
                                      continue
                                  if '%z' in fmt and '+' not in log[field] and '-' not in log[field]:
                                      continue
                                  dt = datetime.strptime(log[field], fmt)
                                  break
                              except ValueError:
                                  continue
                          
                          if dt is None:
                              # Try parsing with dateutil as a fallback
                              from dateutil import parser
                              dt = parser.parse(log[field])
                          
                          # Add timezone if naive
                          if dt.tzinfo is None:
                              dt = pytz.UTC.localize(dt)
                          
                          # Convert to target timezone
                          dt = dt.astimezone(tz)
                          log[field] = dt.isoformat()
                      except Exception as e:
                          # Keep original if parsing fails
                          pass
          
          return logs
      
      # Function to extract and correlate trace and span IDs
      def extract_tracing_info(logs):
          # Create a dictionary to store trace relationships
          traces = {}
          
          for i, log in enumerate(logs):
              trace_id = None
              span_id = None
              parent_span_id = None
              
              # Look for trace and span IDs in various formats
              for key, value in log.items():
                  if isinstance(value, str):
                      # Check for trace ID
                      if key.lower() in ['traceid', 'trace_id', 'trace-id'] or (key.lower() == 'id' and 'trace' in key.lower()):
                          trace_id = value
                      # Check for span ID
                      elif key.lower() in ['spanid', 'span_id', 'span-id'] or (key.lower() == 'id' and 'span' in key.lower()):
                          span_id = value
                      # Check for parent span ID
                      elif key.lower() in ['parentspanid', 'parent_span_id', 'parent-span-id', 'parent_id', 'parentid']:
                          parent_span_id = value
                      # Check in message field
                      elif key.lower() == 'message' and isinstance(value, str):
                          trace_match = re.search(r'\b(?:trace[-_]?id|traceid)\s*[=:,]\s*["']?([a-zA-Z0-9-]+)["']?', value, re.IGNORECASE)
                          span_match = re.search(r'\b(?:span[-_]?id|spanid)\s*[=:,]\s*["']?([a-zA-Z0-9-]+)["']?', value, re.IGNORECASE)
                          parent_match = re.search(r'\b(?:parent[-_]?span[-_]?id|parentspanid)\s*[=:,]\s*["']?([a-zA-Z0-9-]+)["']?', value, re.IGNORECASE)
                          
                          if trace_match and not trace_id:
                              trace_id = trace_match.group(1)
                          if span_match and not span_id:
                              span_id = span_match.group(1)
                          if parent_match and not parent_span_id:
                              parent_span_id = parent_match.group(1)
              
              # Add extracted IDs to the log entry
              if trace_id:
                  log['traceId'] = trace_id
              if span_id:
                  log['spanId'] = span_id
              if parent_span_id:
                  log['parentSpanId'] = parent_span_id
              
              # Build trace relationships
              if trace_id and span_id:
                  if trace_id not in traces:
                      traces[trace_id] = {'spans': {}, 'logs': []}
                  
                  traces[trace_id]['spans'][span_id] = {
                      'parent': parent_span_id,
                      'log_indices': [i]
                  }
                  traces[trace_id]['logs'].append(i)
              
              # Add trace relationship info to the log
              log['_trace_index'] = i
          
          # Add trace relationship info to logs
          for trace_id, trace_info in traces.items():
              # Build span hierarchy
              span_hierarchy = {}
              root_spans = []
              
              for span_id, span_info in trace_info['spans'].items():
                  parent_id = span_info['parent']
                  
                  if not parent_id or parent_id not in trace_info['spans']:
                      root_spans.append(span_id)
                  else:
                      if parent_id not in span_hierarchy:
                          span_hierarchy[parent_id] = []
                      span_hierarchy[parent_id].append(span_id)
              
              # Add trace structure info to each log in the trace
              for log_index in trace_info['logs']:
                  logs[log_index]['_trace_structure'] = {
                      'trace_id': trace_id,
                      'root_spans': root_spans,
                      'span_hierarchy': span_hierarchy,
                      'total_spans': len(trace_info['spans']),
                      'total_logs': len(trace_info['logs'])
                  }
          
          return logs
      
      # Process all log files
      all_logs = []
      processed_files = 0
      failed_files = 0
      
      # Expand directories to individual files
      expanded_files = []
      for file_path in ${JSON.stringify(logFiles)}:
          if os.path.isdir(file_path):
              # Find all files in directory
              expanded_files.extend(glob.glob(os.path.join(file_path, '**', '*.*'), recursive=True))
          else:
              expanded_files.append(file_path)
      
      # Process each file
      for file_path in expanded_files:
          try:
              if not os.path.isfile(file_path):
                  continue
                  
              # Determine format
              format_to_use = ${JSON.stringify(logFormat)}
              if format_to_use == 'auto':
                  format_to_use = detect_format(file_path)
              
              # Parse logs based on format
              file_logs = []
              if format_to_use == 'json':
                  file_logs = parse_json_logs(file_path)
              elif format_to_use == 'xml':
                  file_logs = parse_xml_logs(file_path)
              else:  # text
                  file_logs = parse_text_logs(file_path)
              
              # Add source file information
              for log in file_logs:
                  log['_source_file'] = os.path.basename(file_path)
              
              all_logs.extend(file_logs)
              processed_files += 1
          except Exception as e:
              failed_files += 1
              print(f"Error processing {file_path}: {str(e)}")
      
      # Normalize timestamps
      all_logs = normalize_timestamps(all_logs, ${JSON.stringify(timeZone)})
      
      # Extract and correlate trace and span IDs if requested
      if ${extractTracing}:
          all_logs = extract_tracing_info(all_logs)
      
      # Create output directory if it doesn't exist
      os.makedirs(os.path.dirname(${JSON.stringify(outputPath)}), exist_ok=True)
      
      # Save processed logs
      with open(${JSON.stringify(outputPath)}, 'w', encoding='utf-8') as f:
          json.dump(all_logs, f, indent=2)
      
      # Generate summary statistics
      log_df = pd.DataFrame(all_logs)
      
      stats = {
          "total_logs": len(all_logs),
          "processed_files": processed_files,
          "failed_files": failed_files,
          "output_path": ${JSON.stringify(outputPath)}
      }
      
      # Count by log level if available
      if 'level' in log_df.columns:
          level_counts = log_df['level'].value_counts().to_dict()
          stats["level_counts"] = level_counts
      
      # Count by service if available
      if 'service' in log_df.columns:
          service_counts = log_df['service'].value_counts().to_dict()
          stats["service_counts"] = service_counts
      
      # Trace statistics if available
      if ${extractTracing}:
          trace_ids = [log.get('traceId') for log in all_logs if 'traceId' in log]
          unique_traces = set(trace_ids)
          stats["unique_traces"] = len(unique_traces)
          
          # Count logs with trace info
          stats["logs_with_trace_info"] = len(trace_ids)
          
          # Calculate average logs per trace
          if unique_traces:
              stats["avg_logs_per_trace"] = len(trace_ids) / len(unique_traces)
      
      print(json.dumps(stats))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error parsing log data: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Successfully processed log data:\n\n`;
        responseText += `- Total logs processed: ${result.total_logs}\n`;
        responseText += `- Files processed: ${result.processed_files}\n`;
        
        if (result.failed_files > 0) {
          responseText += `- Files failed: ${result.failed_files}\n`;
        }
        
        responseText += `- Output saved to: ${result.output_path}\n\n`;
        
        if (result.level_counts) {
          responseText += `Log Levels:\n`;
          for (const [level, count] of Object.entries(result.level_counts)) {
            responseText += `- ${level}: ${count}\n`;
          }
          responseText += `\n`;
        }
        
        if (result.service_counts) {
          responseText += `Services:\n`;
          const sortedServices = Object.entries(result.service_counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Show top 10 services
          
          for (const [service, count] of sortedServices) {
            responseText += `- ${service}: ${count}\n`;
          }
          
          if (Object.keys(result.service_counts).length > 10) {
            responseText += `- ... and ${Object.keys(result.service_counts).length - 10} more\n`;
          }
          responseText += `\n`;
        }
        
        if (extractTracing && result.unique_traces) {
          responseText += `Tracing Information:\n`;
          responseText += `- Unique traces: ${result.unique_traces}\n`;
          responseText += `- Logs with trace info: ${result.logs_with_trace_info}\n`;
          if (result.avg_logs_per_trace) {
            responseText += `- Average logs per trace: ${result.avg_logs_per_trace.toFixed(2)}\n`;
          }
        }
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing log processing results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in parse_log_data tool:', error);
      return {
        content: [{ type: 'text', text: `Error parsing log data: ${error.message}` }],
        isError: true
      };
    }
  });