this.server.tool('create_training_dataset', z.object({
    featuresPath: z.string().describe('Path to the extracted features JSON file'),
    outputPath: z.string().describe('Path to save the training dataset'),
    labelingStrategy: z.enum(['auto', 'semi-supervised', 'rules']).describe('Strategy for labeling the dataset'),
    labelingConfig: z.object({
      errorPatterns: z.array(z.object({
        pattern: z.string().describe('Regex pattern to match in log messages'),
        label: z.string().describe('Label to assign when pattern matches'),
        category: z.string().optional().describe('Problem category (e.g., "performance", "error", "security")')
      })).optional().describe('Custom error patterns for rule-based labeling'),
      performanceThresholds: z.object({
        slowResponseTimeMs: z.number().optional().describe('Threshold for slow response time in milliseconds'),
        highCpuUsagePercent: z.number().optional().describe('Threshold for high CPU usage percentage'),
        highMemoryUsageMb: z.number().optional().describe('Threshold for high memory usage in MB')
      }).optional().describe('Thresholds for performance-related labels')
    }).optional().describe('Configuration for the labeling process')
  }).shape, async (params) => {
    /** Create a labeled dataset for training log analysis models */
    try {
      const {
        featuresPath,
        outputPath,
        labelingStrategy,
        labelingConfig = {}
      } = params;
      
      // Default error patterns if none provided
      const errorPatterns = labelingConfig.errorPatterns || [
        { pattern: 'exception|error|failure|failed', label: 'error', category: 'error' },
        { pattern: 'timeout|timed out|slow|latency', label: 'performance_issue', category: 'performance' },
        { pattern: 'memory|heap|out of memory|OOM', label: 'memory_issue', category: 'resource' },
        { pattern: 'cpu|processor|load', label: 'cpu_issue', category: 'resource' },
        { pattern: 'security|auth|permission|access denied', label: 'security_issue', category: 'security' },
        { pattern: 'warning|warn', label: 'warning', category: 'warning' },
        { pattern: 'database|sql|query|db', label: 'database_issue', category: 'database' },
        { pattern: 'network|connection|disconnect', label: 'network_issue', category: 'network' }
      ];
      
      // Default performance thresholds if none provided
      const performanceThresholds = labelingConfig.performanceThresholds || {
        slowResponseTimeMs: 1000,
        highCpuUsagePercent: 80,
        highMemoryUsageMb: 1024
      };
      
      const script = `
  import json
  import os
  import re
  import pandas as pd
  import numpy as np
  from sklearn.cluster import DBSCAN
  from sklearn.preprocessing import StandardScaler
  from sklearn.ensemble import IsolationForest
  from collections import defaultdict, Counter
  
  try:
      # Load extracted features
      with open(${JSON.stringify(featuresPath)}, 'r', encoding='utf-8') as f:
          features = json.load(f)
      
      # Get log entries
      log_entries = features.get("log_entries", [])
      
      # Convert to DataFrame for easier processing
      df = pd.DataFrame(log_entries)
      
      # Initialize dataset
      dataset = {
          "logs": [],
          "metadata": {
              "total_logs": len(log_entries),
              "labeling_strategy": ${JSON.stringify(labelingStrategy)},
              "label_distribution": {}
          }
      }
      
      # Function to extract original log message
      def get_original_log(log_id):
          # This is a simplified approach - in a real system, you'd retrieve the original log
          for entry in log_entries:
              if entry.get("_id") == log_id:
                  return entry
          return None
      
      # Apply labeling strategy
      if ${JSON.stringify(labelingStrategy)} == "auto":
          # Automatic labeling using anomaly detection
          
          # Select numerical features
          numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
          if numeric_cols:
              # Prepare data
              X = df[numeric_cols].fillna(0)
              X_scaled = StandardScaler().fit_transform(X)
              
              # Use Isolation Forest for anomaly detection
              model = IsolationForest(contamination=0.1, random_state=42)
              df["anomaly"] = model.fit_predict(X_scaled)
              df["anomaly_score"] = model.decision_function(X_scaled)
              
              # Label anomalies
              df["label"] = "normal"
              df.loc[df["anomaly"] == -1, "label"] = "anomaly"
              
              # Try to categorize anomalies
              for idx, row in df[df["anomaly"] == -1].iterrows():
                  log_entry = get_original_log(row["_id"])
                  if not log_entry:
                      continue
                      
                  message = log_entry.get("message", "")
                  
                  # Check against error patterns
                  for pattern in ${JSON.stringify(errorPatterns)}:
                      if re.search(pattern["pattern"], message, re.IGNORECASE):
                          df.at[idx, "label"] = pattern["label"]
                          break
                          
                  # Check performance metrics
                  if "response_time" in row and row["response_time"] > ${performanceThresholds.slowResponseTimeMs || 1000}:
                      df.at[idx, "label"] = "slow_response"
          else:
              # Fallback to rule-based labeling if no numeric features
              df["label"] = "normal"
              
              for idx, row in df.iterrows():
                  log_entry = get_original_log(row["_id"])
                  if not log_entry:
                      continue
                      
                  message = log_entry.get("message", "")
                  
                  # Check against error patterns
                  for pattern in ${JSON.stringify(errorPatterns)}:
                      if re.search(pattern["pattern"], message, re.IGNORECASE):
                          df.at[idx, "label"] = pattern["label"]
                          break
      
      elif ${JSON.stringify(labelingStrategy)} == "semi-supervised":
          # Semi-supervised approach: cluster similar logs and label clusters
          
          # Select features for clustering
          cluster_features = []
          
          # Use numeric features if available
          numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
          if numeric_cols:
              cluster_features.extend(numeric_cols)
          
          # Add categorical features as one-hot encoded
          categorical_cols = ["level", "service"]
          for col in categorical_cols:
              if col in df.columns:
                  dummies = pd.get_dummies(df[col], prefix=col)
                  df = pd.concat([df, dummies], axis=1)
                  cluster_features.extend(dummies.columns.tolist())
          
          if cluster_features:
              # Prepare data for clustering
              X = df[cluster_features].fillna(0)
              X_scaled = StandardScaler().fit_transform(X)
              
              # Use DBSCAN for clustering
              dbscan = DBSCAN(eps=0.5, min_samples=5)
              df["cluster"] = dbscan.fit_predict(X_scaled)
              
              # Initialize labels
              df["label"] = "normal"
              
              # Label clusters based on characteristics
              cluster_labels = {}
              
              for cluster_id in df["cluster"].unique():
                  if cluster_id == -1:  # Noise points
                      continue
                      
                  cluster_df = df[df["cluster"] == cluster_id]
                  
                  # Check if cluster has mostly errors
                  if "is_error" in cluster_df.columns and cluster_df["is_error"].mean() > 0.5:
                      cluster_labels[cluster_id] = "error_cluster"
                      
                  # Check if cluster has slow response times
                  elif "response_time" in cluster_df.columns and cluster_df["response_time"].mean() > ${performanceThresholds.slowResponseTimeMs || 1000}:
                      cluster_labels[cluster_id] = "slow_response_cluster"
                      
                  # Check if cluster has unusual timestamps
                  elif "is_business_hours" in cluster_df.columns and cluster_df["is_business_hours"].mean() < 0.2:
                      cluster_labels[cluster_id] = "off_hours_activity"
                      
                  # Default label for other clusters
                  else:
                      cluster_labels[cluster_id] = "normal"
              
              # Apply cluster labels
              for cluster_id, label in cluster_labels.items():
                  df.loc[df["cluster"] == cluster_id, "label"] = label
                  
              # Label noise points using rule-based approach
              for idx, row in df[df["cluster"] == -1].iterrows():
                  log_entry = get_original_log(row["_id"])
                  if not log_entry:
                      continue
                      
                  message = log_entry.get("message", "")
                  
                  # Check against error patterns
                  for pattern in ${JSON.stringify(errorPatterns)}:
                      if re.search(pattern["pattern"], message, re.IGNORECASE):
                          df.at[idx, "label"] = pattern["label"]
                          break
          else:
              # Fallback to rule-based labeling if no features for clustering
              df["label"] = "normal"
              
              for idx, row in df.iterrows():
                  log_entry = get_original_log(row["_id"])
                  if not log_entry:
                      continue
                      
                  message = log_entry.get("message", "")
                  
                  # Check against error patterns
                  for pattern in ${JSON.stringify(errorPatterns)}:
                      if re.search(pattern["pattern"], message, re.IGNORECASE):
                          df.at[idx, "label"] = pattern["label"]
                          break
      
      else:  # rules-based labeling
          # Initialize all as normal
          df["label"] = "normal"
          
          # Apply rule-based labeling
          for idx, row in df.iterrows():
              log_entry = get_original_log(row["_id"])
              if not log_entry:
                  continue
                  
              message = log_entry.get("message", "")
              
              # Check against error patterns
              for pattern in ${JSON.stringify(errorPatterns)}:
                  if re.search(pattern["pattern"], message, re.IGNORECASE):
                      df.at[idx, "label"] = pattern["label"]
                      break
              
              # Check performance metrics
              if "response_time" in row and row["response_time"] > ${performanceThresholds.slowResponseTimeMs || 1000}:
                  df.at[idx, "label"] = "slow_response"
      
      # Create the final dataset
      for idx, row in df.iterrows():
          log_entry = get_original_log(row["_id"])
          if not log_entry:
              continue
              
          # Create training example
          example = {
              "id": row["_id"],
              "features": {},
              "label": row["label"],
              "original_log": log_entry
          }
          
          # Add features
          for col in df.columns:
              if col not in ["_id", "label", "cluster", "anomaly", "anomaly_score"]:
                  example["features"][col] = row[col]
          
          dataset["logs"].append(example)
      
      # Calculate label distribution
      label_counts = Counter(df["label"])
      dataset["metadata"]["label_distribution"] = {label: count for label, count in label_counts.items()}
      
      # Add trace information if available
      if "trace_stats" in features:
          dataset["metadata"]["trace_info"] = features["trace_stats"]
      
      # Add error pattern information
      dataset["metadata"]["error_patterns"] = features.get("error_patterns", {})
      
      # Create output directory if it doesn't exist
      os.makedirs(os.path.dirname(${JSON.stringify(outputPath)}), exist_ok=True)
      
      # Save dataset
      with open(${JSON.stringify(outputPath)}, 'w', encoding='utf-8') as f:
          json.dump(dataset, f, indent=2)
      
      # Generate summary
      summary = {
          "total_logs": len(dataset["logs"]),
          "label_distribution": dataset["metadata"]["label_distribution"],
          "labeling_strategy": ${JSON.stringify(labelingStrategy)},
          "output_path": ${JSON.stringify(outputPath)}
      }
      
      print(json.dumps(summary))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error creating training dataset: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          throw new Error(result.error);
        }
        
        let responseText = `Successfully created training dataset:\n\n`;
        responseText += `- Total logs: ${result.total_logs}\n`;
        responseText += `- Labeling strategy: ${result.labeling_strategy}\n`;
        responseText += `- Output saved to: ${result.output_path}\n\n`;
        
        responseText += `Label distribution:\n`;
        const sortedLabels = Object.entries(result.label_distribution)
          .sort((a, b) => b[1] - a[1]);
        
        for (const [label, count] of sortedLabels) {
          const percentage = ((count / result.total_logs) * 100).toFixed(1);
          responseText += `- ${label}: ${count} (${percentage}%)\n`;
        }
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing dataset creation results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in create_training_dataset tool:', error);
      return {
        content: [{ type: 'text', text: `Error creating training dataset: ${error.message}` }],
        isError: true
      };
    }
  });