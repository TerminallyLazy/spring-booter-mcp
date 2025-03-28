this.server.tool('detect_anomalies', z.object({
    dataPath: z.string().describe('Path to the CSV file containing the data'),
    contamination: z.number().optional().describe('Expected proportion of outliers in the dataset (default: 0.01)'),
    randomState: z.number().optional().describe('Random seed for reproducibility (default: 42)')
  }).shape, async (params) => {
    /** Detect anomalies in data using Isolation Forest algorithm */
    try {
      const {
        dataPath,
        contamination = 0.01,
        randomState = 42
      } = params;
      
      const script = `
  import json
  import pandas as pd
  import numpy as np
  from sklearn.ensemble import IsolationForest
  from sklearn.preprocessing import StandardScaler
  
  try:
      # Load the data
      data = pd.read_csv('${dataPath}')
      
      # Get basic data info
      data_info = {
          "rows": len(data),
          "columns": list(data.columns),
          "column_count": len(data.columns)
      }
      
      # Normalize the feature data
      scaler = StandardScaler()
      data_scaled = scaler.fit_transform(data.select_dtypes(include=[np.number]))
      
      # Train the model
      model = IsolationForest(contamination=${contamination}, random_state=${randomState})
      model.fit(data_scaled)
      
      # Predict the anomalies in the data
      anomalies = model.predict(data_scaled)
      
      # Find the index of anomalies
      anomaly_indices = np.where(anomalies == -1)[0].tolist()
      
      # Get anomaly data
      anomaly_data = data.iloc[anomaly_indices].to_dict(orient='records')
      
      # Calculate anomaly percentage
      anomaly_percentage = (len(anomaly_indices) / len(data)) * 100
      
      result = {
          "success": True,
          "data_info": data_info,
          "anomaly_count": len(anomaly_indices),
          "anomaly_percentage": anomaly_percentage,
          "anomaly_indices": anomaly_indices[:20] if len(anomaly_indices) > 20 else anomaly_indices,  # Limit to first 20 indices
          "anomaly_samples": anomaly_data[:5] if len(anomaly_data) > 5 else anomaly_data  # Limit to first 5 samples
      }
      
      print(json.dumps(result))
  except Exception as e:
      print(json.dumps({"error": str(e), "success": False}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error detecting anomalies: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const result = JSON.parse(stdout);
        if (!result.success) {
          throw new Error(result.error);
        }
        
        let responseText = `Anomaly Detection Results:\n\n`;
        responseText += `Dataset Information:\n`;
        responseText += `- Total Rows: ${result.data_info.rows}\n`;
        responseText += `- Total Columns: ${result.data_info.column_count}\n\n`;
        
        responseText += `Anomaly Summary:\n`;
        responseText += `- Anomalies Found: ${result.anomaly_count} (${result.anomaly_percentage.toFixed(2)}% of data)\n`;
        responseText += `- Contamination Parameter: ${contamination}\n\n`;
        
        if (result.anomaly_indices.length > 0) {
          responseText += `First ${result.anomaly_indices.length} Anomaly Indices: ${result.anomaly_indices.join(', ')}\n\n`;
        }
        
        if (result.anomaly_samples.length > 0) {
          responseText += `Sample Anomalies (first ${result.anomaly_samples.length}):\n`;
          result.anomaly_samples.forEach((sample, index) => {
            responseText += `\nAnomaly #${index + 1}:\n`;
            Object.entries(sample).forEach(([key, value]) => {
              responseText += `- ${key}: ${value}\n`;
            });
          });
        }
        
        return {
          content: [{ type: 'text', text: responseText }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing anomaly detection results: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in detect_anomalies tool:', error);
      return {
        content: [{ type: 'text', text: `Error detecting anomalies: ${error.message}` }],
        isError: true
      };
    }
  });