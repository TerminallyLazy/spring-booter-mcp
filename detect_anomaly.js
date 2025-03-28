this.server.tool('detect_anomalies', z.object({ timeRangeHours: z.number().optional(), services: z.array(z.string()).optional(), sensitivityLevel: z.enum(['low', 'medium', 'high']).optional(), anomalyTypes: z.array(z.enum(['latency', 'error_rate', 'volume', 'pattern'])).optional() }).shape, async (params) => {
    /**
     * Detects anomalies in log data across services using statistical and ML-based methods
     * @param {number} [timeRangeHours=24] - Time range in hours to analyze for anomalies
     * @param {string[]} [services] - Optional list of specific services to analyze (all services if not specified)
     * @param {string} [sensitivityLevel='medium'] - Sensitivity level for anomaly detection (low, medium, high)
     * @param {string[]} [anomalyTypes] - Types of anomalies to look for (defaults to all types)
     */
    try {
      const timeRangeHours = params.timeRangeHours || 24;
      const services = params.services || [];
      const sensitivityLevel = params.sensitivityLevel || 'medium';
      const anomalyTypes = params.anomalyTypes || ['latency', 'error_rate', 'volume', 'pattern'];
      
      // Set sensitivity thresholds based on level
      const sensitivityThresholds = {
        low: {
          latencyStdDevs: 3.0,    // Number of standard deviations for latency anomalies
          errorRateThreshold: 0.2, // 20% increase in error rate
          volumeChangeThreshold: 0.5, // 50% change in volume
          patternSimilarityThreshold: 0.6 // Lower similarity score = more anomalous
        },
        medium: {
          latencyStdDevs: 2.5,
          errorRateThreshold: 0.15,
          volumeChangeThreshold: 0.3,
          patternSimilarityThreshold: 0.7
        },
        high: {
          latencyStdDevs: 2.0,
          errorRateThreshold: 0.1,
          volumeChangeThreshold: 0.2,
          patternSimilarityThreshold: 0.8
        }
      };
      
      const thresholds = sensitivityThresholds[sensitivityLevel];
      
      // First, get a list of all services if not specified
      let servicesToAnalyze = services;
      if (servicesToAnalyze.length === 0) {
        const servicesResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/services'}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.env.DB_API_KEY}`
          }
        });
        
        if (!servicesResponse.ok) {
          throw new Error(`Failed to retrieve services: ${servicesResponse.status}`);
        }
        
        const servicesData = await servicesResponse.json();
        servicesToAnalyze = servicesData.services || [];
        
        if (servicesToAnalyze.length === 0) {
          return {
            content: [{ type: 'text', text: 'No services found in the logs.' }]
          };
        }
      }
      
      // Initialize results
      const anomalies = [];
      
      // Process each service
      for (const service of servicesToAnalyze) {
        // Get metrics for this service over time
        const metricsResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/metrics'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.env.DB_API_KEY}`
          },
          body: JSON.stringify({
            service: service,
            timeRangeHours: timeRangeHours,
            intervalMinutes: 5 // 5-minute intervals for time series
          })
        });
        
        if (!metricsResponse.ok) {
          console.error(`Failed to retrieve metrics for service ${service}: ${metricsResponse.status}`);
          continue; // Skip this service
        }
        
        const metricsData = await metricsResponse.json();
        
        if (!metricsData.intervals || metricsData.intervals.length === 0) {
          continue; // Skip this service if no metrics
        }
        
        // Analyze latency anomalies
        if (anomalyTypes.includes('latency')) {
          const latencies = metricsData.intervals.map(interval => interval.avgLatencyMs);
          const avgLatency = latencies.reduce((sum, val) => sum + val, 0) / latencies.length;
          const stdDevLatency = Math.sqrt(
            latencies.reduce((sum, val) => sum + Math.pow(val - avgLatency, 2), 0) / latencies.length
          );
          
          // Find intervals with anomalous latency
          metricsData.intervals.forEach(interval => {
            if (Math.abs(interval.avgLatencyMs - avgLatency) > thresholds.latencyStdDevs * stdDevLatency) {
              anomalies.push({
                type: 'latency',
                service: service,
                timestamp: interval.timestamp,
                value: interval.avgLatencyMs,
                threshold: avgLatency + thresholds.latencyStdDevs * stdDevLatency,
                baseline: avgLatency,
                description: `Latency spike of ${interval.avgLatencyMs.toFixed(2)}ms (${(interval.avgLatencyMs / avgLatency).toFixed(2)}x normal)`
              });
            }
          });
        }
        
        // Analyze error rate anomalies
        if (anomalyTypes.includes('error_rate')) {
          const errorRates = metricsData.intervals.map(interval => interval.errorRate);
          const avgErrorRate = errorRates.reduce((sum, val) => sum + val, 0) / errorRates.length;
          
          // Find intervals with anomalous error rates
          metricsData.intervals.forEach(interval => {
            if (interval.errorRate > avgErrorRate * (1 + thresholds.errorRateThreshold)) {
              anomalies.push({
                type: 'error_rate',
                service: service,
                timestamp: interval.timestamp,
                value: interval.errorRate,
                threshold: avgErrorRate * (1 + thresholds.errorRateThreshold),
                baseline: avgErrorRate,
                description: `Error rate spike of ${(interval.errorRate * 100).toFixed(2)}% (${(interval.errorRate / avgErrorRate).toFixed(2)}x normal)`
              });
            }
          });
        }
        
        // Analyze volume anomalies
        if (anomalyTypes.includes('volume')) {
          const volumes = metricsData.intervals.map(interval => interval.logCount);
          const avgVolume = volumes.reduce((sum, val) => sum + val, 0) / volumes.length;
          
          // Find intervals with anomalous volumes
          metricsData.intervals.forEach(interval => {
            const volumeChange = Math.abs(interval.logCount - avgVolume) / avgVolume;
            if (volumeChange > thresholds.volumeChangeThreshold) {
              anomalies.push({
                type: 'volume',
                service: service,
                timestamp: interval.timestamp,
                value: interval.logCount,
                threshold: avgVolume * (1 + thresholds.volumeChangeThreshold),
                baseline: avgVolume,
                description: `Log volume ${interval.logCount > avgVolume ? 'spike' : 'drop'} of ${interval.logCount} logs (${volumeChange.toFixed(2)}x change from normal)`
              });
            }
          });
        }
        
        // Analyze pattern anomalies (requires embeddings)
        if (anomalyTypes.includes('pattern')) {
          // Get recent log patterns for this service
          const patternsResponse = await fetch(`${this.env.DB_API_URL || 'http://localhost:8080/api/logs/patterns'}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.env.DB_API_KEY}`
            },
            body: JSON.stringify({
              service: service,
              timeRangeHours: timeRangeHours,
              clusterCount: 5 // Find top 5 patterns
            })
          });
          
          if (!patternsResponse.ok) {
            console.error(`Failed to retrieve patterns for service ${service}: ${patternsResponse.status}`);
            continue; // Skip pattern analysis for this service
          }
          
          const patternsData = await patternsResponse.json();
          
          if (patternsData.anomalousPatterns && patternsData.anomalousPatterns.length > 0) {
            patternsData.anomalousPatterns.forEach(pattern => {
              if (pattern.similarityScore < thresholds.patternSimilarityThreshold) {
                anomalies.push({
                  type: 'pattern',
                  service: service,
                  timestamp: pattern.firstSeen,
                  value: pattern.similarityScore,
                  threshold: thresholds.patternSimilarityThreshold,
                  sampleMessage: pattern.sampleMessage,
                  occurrences: pattern.occurrences,
                  description: `Unusual log pattern detected: "${pattern.sampleMessage.substring(0, 100)}..." (${pattern.occurrences} occurrences)`
                });
              }
            });
          }
        }
      }
      
      // Sort anomalies by timestamp (most recent first)
      anomalies.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Group anomalies by service
      const anomaliesByService = {};
      anomalies.forEach(anomaly => {
        if (!anomaliesByService[anomaly.service]) {
          anomaliesByService[anomaly.service] = [];
        }
        anomaliesByService[anomaly.service].push(anomaly);
      });
      
      // Format the response
      const response = {
        timeRange: `${timeRangeHours} hours`,
        sensitivityLevel: sensitivityLevel,
        totalAnomalies: anomalies.length,
        anomaliesByService: anomaliesByService,
        anomaliesByType: {
          latency: anomalies.filter(a => a.type === 'latency').length,
          error_rate: anomalies.filter(a => a.type === 'error_rate').length,
          volume: anomalies.filter(a => a.type === 'volume').length,
          pattern: anomalies.filter(a => a.type === 'pattern').length
        }
      };
      
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
      };
    } catch (error) {
      console.error('Error detecting anomalies:', error);
      return {
        content: [{ type: 'text', text: `Error detecting anomalies: ${error.message}` }],
        isError: true
      };
    }
  });