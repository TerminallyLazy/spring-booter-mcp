this.server.tool('real_time_log_monitor', z.object({
    logSourceConfig: z.object({
      type: z.enum(['file', 'kafka', 'api']).describe('Type of log source'),
      path: z.string().optional().describe('Path to log file or directory (for file type)'),
      topic: z.string().optional().describe('Kafka topic (for kafka type)'),
      url: z.string().optional().describe('API endpoint URL (for api type)'),
      credentials: z.object({
        username: z.string().optional().describe('Username for authentication'),
        password: z.string().optional().describe('Password for authentication'),
        apiKey: z.string().optional().describe('API key for authentication')
      }).optional().describe('Credentials for authentication')
    }).describe('Configuration for the log source'),
    modelPath: z.string().describe('Path to the fine-tuned model for log analysis'),
    alertConfig: z.object({
      enableAlerts: z.boolean().optional().describe('Whether to enable alerting (default: true)'),
      alertThreshold: z.number().optional().describe('Threshold for alerting (default: 0.7)'),
      alertDestination: z.enum(['console', 'webhook', 'email']).optional().describe('Where to send alerts (default: console)'),
      webhookUrl: z.string().optional().describe('Webhook URL for sending alerts'),
      emailConfig: z.object({
        smtpServer: z.string().optional().describe('SMTP server for sending emails'),
        smtpPort: z.number().optional().describe('SMTP port'),
        sender: z.string().optional().describe('Sender email address'),
        recipients: z.array(z.string()).optional().describe('Recipient email addresses')
      }).optional().describe('Email configuration for alerts')
    }).optional().describe('Configuration for alerting'),
    monitorDuration: z.number().optional().describe('Duration to run the monitor in seconds (default: 300, 0 for indefinite)'),
    batchSize: z.number().optional().describe('Number of logs to process in each batch (default: 10)')
  }).shape, async (params) => {
    /** Set up real-time log monitoring with anomaly detection and alerting */
    try {
      const {
        logSourceConfig,
        modelPath,
        alertConfig = {
          enableAlerts: true,
          alertThreshold: 0.7,
          alertDestination: 'console'
        },
        monitorDuration = 300,
        batchSize = 10
      } = params;
      
      // Validate log source configuration
      if (logSourceConfig.type === 'file' && !logSourceConfig.path) {
        return {
          content: [{ type: 'text', text: 'Error: Path must be provided for file log source' }],
          isError: true
        };
      }
      
      if (logSourceConfig.type === 'kafka' && !logSourceConfig.topic) {
        return {
          content: [{ type: 'text', text: 'Error: Topic must be provided for Kafka log source' }],
          isError: true
        };
      }
      
      if (logSourceConfig.type === 'api' && !logSourceConfig.url) {
        return {
          content: [{ type: 'text', text: 'Error: URL must be provided for API log source' }],
          isError: true
        };
      }
      
      // Validate alert configuration
      if (alertConfig.alertDestination === 'webhook' && !alertConfig.webhookUrl) {
        return {
          content: [{ type: 'text', text: 'Error: Webhook URL must be provided for webhook alert destination' }],
          isError: true
        };
      }
      
      if (alertConfig.alertDestination === 'email' && (!alertConfig.emailConfig || !alertConfig.emailConfig.smtpServer || !alertConfig.emailConfig.sender || !alertConfig.emailConfig.recipients)) {
        return {
          content: [{ type: 'text', text: 'Error: Email configuration must be provided for email alert destination' }],
          isError: true
        };
      }
      
      const script = `
  import json
  import os
  import re
  import time
  import threading
  import queue
  import signal
  import sys
  import datetime
  import requests
  import smtplib
  from email.mime.text import MIMEText
  from email.mime.multipart import MIMEMultipart
  from collections import defaultdict, deque
  from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
  from sklearn.ensemble import IsolationForest
  
  try:
      # Set up signal handler for graceful shutdown
      shutdown_event = threading.Event()
      
      def signal_handler(sig, frame):
          print("Shutting down log monitor...")
          shutdown_event.set()
      
      signal.signal(signal.SIGINT, signal_handler)
      
      # Load the model and tokenizer
      print("Loading model from ${modelPath}...")
      model = AutoModelForCausalLM.from_pretrained("${modelPath}")
      tokenizer = AutoTokenizer.from_pretrained("${modelPath}")
      
      # Create a text generation pipeline
      generator = pipeline(
          "text-generation",
          model=model,
          tokenizer=tokenizer,
          max_new_tokens=256,
          temperature=0.7,
          top_p=0.9,
          do_sample=True
      )
      
      # Initialize anomaly detection model
      isolation_forest = IsolationForest(contamination=0.1, random_state=42)
      
      # Set up log source
      log_queue = queue.Queue(maxsize=1000)  # Buffer for logs
      trace_context = defaultdict(list)  # Store logs by trace ID
      
      # Function to send alerts
      def send_alert(log, analysis):
          alert_message = f"""\n
  ===== LOG ANALYSIS ALERT =====
  Timestamp: {datetime.datetime.now().isoformat()}
  
  Log: 
  {log.get('message', '')}
  
  Analysis: 
  {analysis}
  
  Service: {log.get('service', 'Unknown')}
  Level: {log.get('level', 'Unknown')}
  Trace ID: {log.get('traceId', 'Unknown')}
  ============================\n"""
          
          # Send alert based on configuration
          if ${JSON.stringify(alertConfig.alertDestination)} == "console":
              print(alert_message)
          
          elif ${JSON.stringify(alertConfig.alertDestination)} == "webhook":
              try:
                  webhook_url = ${JSON.stringify(alertConfig.webhookUrl || '')}
                  payload = {
                      "text": alert_message,
                      "log": log,
                      "analysis": analysis
                  }
                  response = requests.post(webhook_url, json=payload)
                  if response.status_code != 200:
                      print(f"Failed to send webhook alert: {response.text}")
              except Exception as e:
                  print(f"Error sending webhook alert: {str(e)}")
          
          elif ${JSON.stringify(alertConfig.alertDestination)} == "email":
              try:
                  # Email configuration
                  smtp_server = ${JSON.stringify(alertConfig.emailConfig?.smtpServer || '')}
                  smtp_port = ${JSON.stringify(alertConfig.emailConfig?.smtpPort || 587)}
                  sender = ${JSON.stringify(alertConfig.emailConfig?.sender || '')}
                  recipients = ${JSON.stringify(alertConfig.emailConfig?.recipients || [])}
                  
                  # Create message
                  msg = MIMEMultipart()
                  msg["Subject"] = f"Log Analysis Alert: {log.get('service', 'Unknown')} - {log.get('level', 'Unknown')}"
                  msg["From"] = sender
                  msg["To"] = ", ".join(recipients)
                  
                  # Add body
                  msg.attach(MIMEText(alert_message, "plain"))
                  
                  # Send email
                  with smtplib.SMTP(smtp_server, smtp_port) as server:
                      server.starttls()
                      # If credentials provided, login
                      if ${JSON.stringify(!!alertConfig.emailConfig?.username)} and ${JSON.stringify(!!alertConfig.emailConfig?.password)}:
                          server.login(${JSON.stringify(alertConfig.emailConfig?.username || '')}, ${JSON.stringify(alertConfig.emailConfig?.password || '')})
                      server.send_message(msg)
              except Exception as e:
                  print(f"Error sending email alert: {str(e)}")
      
      # Function to analyze a log entry
      def analyze_log(log):
          # Skip if no message
          if not log.get("message"):
              return None, 0
          
          # Prepare prompt
          prompt = f"""You are a log analysis assistant that helps identify and explain issues in system logs.
  
  Analyze the following log entry and provide a concise explanation of any issues:
  
  Timestamp: {log.get('timestamp', '')}
  Service: {log.get('service', '')}
  Level: {log.get('level', '')}
  Message: {log.get('message', '')}
  """
          
          # Add trace context if available
          trace_id = log.get("traceId")
          if trace_id and trace_id in trace_context and len(trace_context[trace_id]) > 1:
              prompt += "\n\nHere are some related logs from the same trace:\n"
              for i, related_log in enumerate(trace_context[trace_id][-3:]):
                  if related_log != log:  # Skip the current log
                      prompt += f"\nRelated Log {i+1}:\n"
                      prompt += f"Timestamp: {related_log.get('timestamp', '')}\n"
                      prompt += f"Service: {related_log.get('service', '')}\n"
                      prompt += f"Level: {related_log.get('level', '')}\n"
                      prompt += f"Message: {related_log.get('message', '')[:200]}{'...' if len(related_log.get('message', '')) > 200 else ''}\n"
          
          # Generate analysis
          try:
              result = generator(prompt)
              analysis = result[0]["generated_text"].replace(prompt, "").strip()
              
              # Calculate severity score based on keywords and log level
              severity_score = 0
              
              # Check log level
              if log.get("level", "").upper() in ["ERROR", "SEVERE", "FATAL", "CRITICAL"]:
                  severity_score += 0.5
              elif log.get("level", "").upper() in ["WARNING", "WARN"]:
                  severity_score += 0.3
              
              # Check for error keywords in the analysis
              error_keywords = ["error", "exception", "fail", "failed", "critical", "issue", "problem", "crash", "timeout"]
              for keyword in error_keywords:
                  if keyword in analysis.lower():
                      severity_score += 0.1
              
              # Check for urgency keywords
              urgency_keywords = ["immediate", "urgent", "attention", "required", "serious", "severe"]
              for keyword in urgency_keywords:
                  if keyword in analysis.lower():
                      severity_score += 0.1
              
              # Cap at 1.0
              severity_score = min(severity_score, 1.0)
              
              return analysis, severity_score
          except Exception as e:
              print(f"Error generating analysis: {str(e)}")
              return None, 0
      
      # Function to read logs from file
      def read_file_logs():
          path = ${JSON.stringify(logSourceConfig.path || '')}
          
          if not os.path.exists(path):
              print(f"Error: Path {path} does not exist")
              return
          
          if os.path.isdir(path):
              # Monitor all log files in directory
              log_files = [os.path.join(path, f) for f in os.listdir(path) if f.endswith(".log")]
          else:
              # Monitor single file
              log_files = [path]
          
          # Keep track of file positions
          file_positions = {f: os.path.getsize(f) for f in log_files}
          
          while not shutdown_event.is_set():
              for file_path in log_files:
                  try:
                      # Check if file has grown
                      current_size = os.path.getsize(file_path)
                      if current_size > file_positions[file_path]:
                          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                              # Seek to last position
                              f.seek(file_positions[file_path])
                              
                              # Read new lines
                              for line in f:
                                  try:
                                      # Try to parse as JSON
                                      log = json.loads(line.strip())
                                      log_queue.put(log)
                                  except json.JSONDecodeError:
                                      # Treat as plain text
                                      log = {"message": line.strip(), "_source": file_path}
                                      log_queue.put(log)
                          
                          # Update file position
                          file_positions[file_path] = current_size
                  except Exception as e:
                      print(f"Error reading file {file_path}: {str(e)}")
              
              # Sleep before checking again
              time.sleep(1)
      
      # Function to read logs from Kafka
      def read_kafka_logs():
          try:
              from kafka import KafkaConsumer
              
              # Create Kafka consumer
              consumer = KafkaConsumer(
                  ${JSON.stringify(logSourceConfig.topic || '')},
                  bootstrap_servers=['localhost:9092'],  # Default Kafka server
                  auto_offset_reset='latest',
                  enable_auto_commit=True,
                  group_id='log_monitor',
                  value_deserializer=lambda x: json.loads(x.decode('utf-8'))
              )
              
              # Process messages
              for message in consumer:
                  if shutdown_event.is_set():
                      break
                      
                  log = message.value
                  log_queue.put(log)
          except Exception as e:
              print(f"Error reading from Kafka: {str(e)}")
      
      # Function to read logs from API
      def read_api_logs():
          url = ${JSON.stringify(logSourceConfig.url || '')}
          
          # Set up authentication if provided
          auth = None
          headers = {}
          
          if ${JSON.stringify(!!logSourceConfig.credentials)}:
              if ${JSON.stringify(!!logSourceConfig.credentials?.username)} and ${JSON.stringify(!!logSourceConfig.credentials?.password)}:
                  auth = (${JSON.stringify(logSourceConfig.credentials?.username || '')}, ${JSON.stringify(logSourceConfig.credentials?.password || '')})
              
              if ${JSON.stringify(!!logSourceConfig.credentials?.apiKey)}:
                  headers["Authorization"] = f"Bearer {${JSON.stringify(logSourceConfig.credentials?.apiKey || '')}}"
          
          # Keep track of last timestamp
          last_timestamp = None
          
          while not shutdown_event.is_set():
              try:
                  # Build query parameters
                  params = {}
                  if last_timestamp:
                      params["since"] = last_timestamp
                  
                  # Make API request
                  response = requests.get(url, params=params, auth=auth, headers=headers)
                  
                  if response.status_code == 200:
                      logs = response.json()
                      
                      # Process logs
                      for log in logs:
                          log_queue.put(log)
                          
                          # Update last timestamp if available
                          if "timestamp" in log:
                              last_timestamp = log["timestamp"]
                  else:
                      print(f"Error from API: {response.status_code} - {response.text}")
              except Exception as e:
                  print(f"Error reading from API: {str(e)}")
              
              # Sleep before next request
              time.sleep(5)
      
      # Start log source thread based on type
      if ${JSON.stringify(logSourceConfig.type)} == "file":
          log_source_thread = threading.Thread(target=read_file_logs)
      elif ${JSON.stringify(logSourceConfig.type)} == "kafka":
          log_source_thread = threading.Thread(target=read_kafka_logs)
      else:  # api
          log_source_thread = threading.Thread(target=read_api_logs)
      
      log_source_thread.daemon = True
      log_source_thread.start()
      
      print(f"Started log monitor for {${JSON.stringify(logSourceConfig.type)}} source")
      
      # Initialize statistics
      stats = {
          "logs_processed": 0,
          "alerts_generated": 0,
          "start_time": time.time(),
          "traces_seen": set(),
          "services_seen": set(),
          "error_logs": 0,
          "warning_logs": 0
      }
      
      # Recent logs for anomaly detection
      recent_logs = deque(maxlen=100)
      
      # Process logs until shutdown or duration reached
      end_time = time.time() + ${monitorDuration} if ${monitorDuration} > 0 else float('inf')
      
      while time.time() < end_time and not shutdown_event.is_set():
          # Process logs in batches
          logs_batch = []
          
          # Try to get logs from queue
          try:
              while len(logs_batch) < ${batchSize}:
                  try:
                      log = log_queue.get(block=True, timeout=1)
                      logs_batch.append(log)
                      log_queue.task_done()
                  except queue.Empty:
                      break
          except Exception as e:
              print(f"Error getting logs from queue: {str(e)}")
              continue
          
          if not logs_batch:
              continue
          
          # Process each log
          for log in logs_batch:
              # Update statistics
              stats["logs_processed"] += 1
              
              # Extract service and level
              service = log.get("service")
              level = log.get("level", "").upper()
              trace_id = log.get("traceId")
              
              if service:
                  stats["services_seen"].add(service)
              
              if trace_id:
                  stats["traces_seen"].add(trace_id)
                  # Add to trace context
                  trace_context[trace_id].append(log)
                  # Limit trace context size
                  if len(trace_context[trace_id]) > 20:
                      trace_context[trace_id] = trace_context[trace_id][-20:]
              
              if level in ["ERROR", "SEVERE", "FATAL", "CRITICAL"]:
                  stats["error_logs"] += 1
              elif level in ["WARNING", "WARN"]:
                  stats["warning_logs"] += 1
              
              # Add to recent logs for anomaly detection
              recent_logs.append(log)
              
              # Analyze log
              analysis, severity_score = analyze_log(log)
              
              # Check if alert should be sent
              if ${JSON.stringify(alertConfig.enableAlerts)} and severity_score >= ${JSON.stringify(alertConfig.alertThreshold)}:
                  send_alert(log, analysis)
                  stats["alerts_generated"] += 1
          
          # Perform anomaly detection if we have enough logs
          if len(recent_logs) >= 50:
              try:
                  # Extract features for anomaly detection
                  features = []
                  for log in recent_logs:
                      # Create a simple feature vector
                      feature = [
                          1 if log.get("level", "").upper() in ["ERROR", "SEVERE", "FATAL", "CRITICAL"] else 0,
                          1 if log.get("level", "").upper() in ["WARNING", "WARN"] else 0,
                          len(log.get("message", "")) if isinstance(log.get("message"), str) else 0
                      ]
                      features.append(feature)
                  
                  # Fit and predict
                  isolation_forest.fit(features)
                  predictions = isolation_forest.predict(features)
                  
                  # Check for anomalies
                  for i, pred in enumerate(predictions):
                      if pred == -1:  # Anomaly
                          log = list(recent_logs)[i]
                          
                          # Only alert if not already alerted based on severity
                          analysis, severity_score = analyze_log(log)
                          
                          if ${JSON.stringify(alertConfig.enableAlerts)} and severity_score < ${JSON.stringify(alertConfig.alertThreshold)}:
                              # This is an anomaly that wasn't caught by severity scoring
                              analysis = "ANOMALY DETECTED: " + (analysis or "Unusual log pattern detected by anomaly detection algorithm.")
                              send_alert(log, analysis)
                              stats["alerts_generated"] += 1
              except Exception as e:
                  print(f"Error in anomaly detection: {str(e)}")
          
          # Print progress every 100 logs
          if stats["logs_processed"] % 100 == 0:
              elapsed = time.time() - stats["start_time"]
              print(f"Processed {stats["logs_processed"]} logs in {elapsed:.2f} seconds")
              print(f"Alerts generated: {stats["alerts_generated"]}")
              print(f"Unique traces: {len(stats["traces_seen"])}")
              print(f"Unique services: {len(stats["services_seen"])}")
              print(f"Error logs: {stats["error_logs"]}")
              print(f"Warning logs: {stats["warning_logs"]}")
              print("---")
      
      # Calculate final statistics
      elapsed = time.time() - stats["start_time"]
      logs_per_second = stats["logs_processed"] / elapsed if elapsed > 0 else 0
      
      summary = {
          "logs_processed": stats["logs_processed"],
          "alerts_generated": stats["alerts_generated"],
          "unique_traces": len(stats["traces_seen"]),
          "unique_services": len(stats["services_seen"]),
          "error_logs": stats["error_logs"],
          "warning_logs": stats["warning_logs"],
          "elapsed_seconds": elapsed,
          "logs_per_second": logs_per_second
      }
      
      print(json.dumps(summary))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      // Start the monitoring process
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error setting up log monitor: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Log Monitoring Summary:\n\n`;
        responseText += `- Logs processed: ${result.logs_processed}\n`;
        responseText += `- Alerts generated: ${result.alerts_generated}\n`;
        responseText += `- Unique traces: ${result.unique_traces}\n`;
        responseText += `- Unique services: ${result.unique_services}\n`;
        responseText += `- Error logs: ${result.error_logs}\n`;
        responseText += `- Warning logs: ${result.warning_logs}\n`;
        responseText += `- Monitoring duration: ${result.elapsed_seconds.toFixed(2)} seconds\n`;
        responseText += `- Processing rate: ${result.logs_per_second.toFixed(2)} logs/second\n\n`;
        
        responseText += `Log source: ${logSourceConfig.type}\n`;
        if (logSourceConfig.type === 'file') {
          responseText += `- Path: ${logSourceConfig.path}\n`;
        } else if (logSourceConfig.type === 'kafka') {
          responseText += `- Topic: ${logSourceConfig.topic}\n`;
        } else if (logSourceConfig.type === 'api') {
          responseText += `- URL: ${logSourceConfig.url}\n`;
        }
        
        responseText += `\nAlert configuration:\n`;
        responseText += `- Alerts enabled: ${alertConfig.enableAlerts}\n`;
        responseText += `- Alert threshold: ${alertConfig.alertThreshold}\n`;
        responseText += `- Alert destination: ${alertConfig.alertDestination}\n`;
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing log monitoring results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in real_time_log_monitor tool:', error);
      return {
        content: [{ type: 'text', text: `Error setting up log monitor: ${error.message}` }],
        isError: true
      };
    }
  });