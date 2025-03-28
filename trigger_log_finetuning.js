this.server.tool('trigger_log_finetuning', z.object({ datasetPath: z.string().min(1, 'Dataset path is required'), baseModel: z.string().optional(), outputDir: z.string().optional(), maxSteps: z.number().optional(), batchSize: z.number().optional(), learningRate: z.number().optional() }).shape, async (params) => {
    /**
     * Starts a fine-tuning job using Unsloth to train a model on log analysis data
     * @param {string} datasetPath - Path to the dataset file for fine-tuning
     * @param {string} [baseModel='unsloth/Llama-3.2-1B'] - Base model to use for fine-tuning
     * @param {string} [outputDir='./models/log-analyzer'] - Directory to save the fine-tuned model
     * @param {number} [maxSteps=150] - Maximum number of training steps
     * @param {number} [batchSize=2] - Batch size for training
     * @param {number} [learningRate=2e-4] - Learning rate for training
     */
    try {
      const datasetPath = params.datasetPath;
      const baseModel = params.baseModel || 'unsloth/Llama-3.2-1B';
      const outputDir = params.outputDir || './models/log-analyzer';
      const maxSteps = params.maxSteps || 150;
      const batchSize = params.batchSize || 2;
      const learningRate = params.learningRate || 2e-4;
      
      // Call the Unsloth MCP server to start fine-tuning
      const finetunePath = this.env.UNSLOTH_API_URL || 'http://localhost:8080/api/unsloth/finetune';
      
      const finetunResponse = await fetch(finetunePath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.UNSLOTH_API_KEY}`
        },
        body: JSON.stringify({
          model_name: baseModel,
          dataset_name: datasetPath,
          output_dir: outputDir,
          max_steps: maxSteps,
          batch_size: batchSize,
          learning_rate: learningRate,
          dataset_text_field: 'text',
          load_in_4bit: true,
          max_seq_length: 2048,
          lora_rank: 16,
          lora_alpha: 16,
          gradient_accumulation_steps: 4
        })
      });
      
      if (!finetunResponse.ok) {
        const errorText = await finetunResponse.text();
        throw new Error(`Fine-tuning request failed: ${finetunResponse.status} ${errorText}`);
      }
      
      const finetunResult = await finetunResponse.json();
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Fine-tuning job started successfully',
            jobDetails: {
              baseModel: baseModel,
              datasetPath: datasetPath,
              outputDir: outputDir,
              maxSteps: maxSteps,
              batchSize: batchSize,
              learningRate: learningRate
            },
            result: finetunResult
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error triggering fine-tuning job:', error);
      return {
        content: [{ type: 'text', text: `Error triggering fine-tuning: ${error.message}` }],
        isError: true
      };
    }
  });