this.server.tool('list_supported_models', z.object({}).shape, async (params) => {
    /** List all models supported by Unsloth for fine-tuning */
    try {
      const script = `
  import json
  try:
      # Define a list of supported models
      models = [
          "unsloth/Llama-3.3-70B-Instruct-bnb-4bit",
          "unsloth/Llama-3.2-1B-bnb-4bit",
          "unsloth/Llama-3.2-1B-Instruct-bnb-4bit",
          "unsloth/Llama-3.2-3B-bnb-4bit",
          "unsloth/Llama-3.2-3B-Instruct-bnb-4bit",
          "unsloth/Llama-3.1-8B-bnb-4bit",
          "unsloth/Mistral-7B-Instruct-v0.3-bnb-4bit",
          "unsloth/Mistral-Small-Instruct-2409",
          "unsloth/Phi-3.5-mini-instruct",
          "unsloth/Phi-3-medium-4k-instruct",
          "unsloth/gemma-2-9b-bnb-4bit",
          "unsloth/gemma-2-27b-bnb-4bit",
          "unsloth/Qwen-2.5-7B"
      ]
      print(json.dumps(models))
  except Exception as e:
      print(json.dumps({"error": str(e)}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error listing supported models: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const models = JSON.parse(stdout);
        if (models.error) {
          throw new Error(models.error);
        }
        
        return {
          content: [{ type: 'text', text: 'Supported Unsloth Models:\n\n' + models.map(m => `- ${m}`).join('\n') }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error parsing model list: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in list_supported_models tool:', error);
      return {
        content: [{ type: 'text', text: `Error listing supported models: ${error.message}` }],
        isError: true
      };
    }
  });