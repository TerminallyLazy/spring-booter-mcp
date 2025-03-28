this.server.tool('load_model', z.object({
    modelName: z.string().describe('Name of the model to load (e.g., "unsloth/Llama-3.2-1B")'),
    maxSeqLength: z.number().optional().describe('Maximum sequence length for the model (default: 2048)'),
    loadIn4bit: z.boolean().optional().describe('Whether to load the model in 4-bit quantization (default: true)'),
    useGradientCheckpointing: z.boolean().optional().describe('Whether to use gradient checkpointing to save memory (default: true)')
  }).shape, async (params) => {
    /** Load a pretrained model with Unsloth optimizations for faster inference and fine-tuning */
    try {
      const { modelName, maxSeqLength = 2048, loadIn4bit = true, useGradientCheckpointing = true } = params;
      
      const script = `
  import json
  try:
      from unsloth import FastLanguageModel
      
      # Load the model
      model, tokenizer = FastLanguageModel.from_pretrained(
          model_name="${modelName}",
          max_seq_length=${maxSeqLength},
          load_in_4bit=${loadIn4bit ? 'True' : 'False'},
          use_gradient_checkpointing=${useGradientCheckpointing ? '"unsloth"' : 'False'}
      )
      
      # Get model info
      model_info = {
          "model_name": "${modelName}",
          "max_seq_length": ${maxSeqLength},
          "load_in_4bit": ${loadIn4bit},
          "use_gradient_checkpointing": ${useGradientCheckpointing},
          "vocab_size": tokenizer.vocab_size,
          "model_type": model.config.model_type,
          "success": True
      }
      
      print(json.dumps(model_info))
  except Exception as e:
      print(json.dumps({"error": str(e), "success": False}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error loading model: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const modelInfo = JSON.parse(stdout);
        if (!modelInfo.success) {
          throw new Error(modelInfo.error);
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: `Successfully loaded model: ${modelName}\n\nModel Information:\n- Model Type: ${modelInfo.model_type}\n- Vocabulary Size: ${modelInfo.vocab_size}\n- Max Sequence Length: ${modelInfo.max_seq_length}\n- 4-bit Quantization: ${modelInfo.load_in_4bit ? 'Enabled' : 'Disabled'}\n- Gradient Checkpointing: ${modelInfo.use_gradient_checkpointing ? 'Enabled' : 'Disabled'}`
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error loading model: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in load_model tool:', error);
      return {
        content: [{ type: 'text', text: `Error loading model: ${error.message}` }],
        isError: true
      };
    }
  });