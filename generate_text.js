this.server.tool('generate_text', z.object({
    modelPath: z.string().describe('Path to the fine-tuned model'),
    prompt: z.string().describe('Prompt for text generation'),
    maxNewTokens: z.number().optional().describe('Maximum number of tokens to generate (default: 256)'),
    temperature: z.number().optional().describe('Temperature for text generation (default: 0.7)'),
    topP: z.number().optional().describe('Top-p for text generation (default: 0.9)')
  }).shape, async (params) => {
    /** Generate text using a fine-tuned Unsloth model */
    try {
      const {
        modelPath,
        prompt,
        maxNewTokens = 256,
        temperature = 0.7,
        topP = 0.9
      } = params;
      
      const script = `
  import json
  try:
      from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
      
      # Load the model and tokenizer
      model = AutoModelForCausalLM.from_pretrained("${modelPath}")
      tokenizer = AutoTokenizer.from_pretrained("${modelPath}")
      
      # Create a text generation pipeline
      generator = pipeline(
          "text-generation",
          model=model,
          tokenizer=tokenizer,
          max_new_tokens=${maxNewTokens},
          temperature=${temperature},
          top_p=${topP},
          do_sample=True
      )
      
      # Generate text
      result = generator("${prompt.replace(/"/g, '\\"')}")
      
      print(json.dumps({
          "success": True,
          "prompt": "${prompt.replace(/"/g, '\\"')}",
          "generated_text": result[0]["generated_text"]
      }))
  except Exception as e:
      print(json.dumps({"error": str(e), "success": False}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error generating text: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const generationResult = JSON.parse(stdout);
        if (!generationResult.success) {
          throw new Error(generationResult.error);
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: `Generated Text:\n\n${generationResult.generated_text}`
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error generating text: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in generate_text tool:', error);
      return {
        content: [{ type: 'text', text: `Error generating text: ${error.message}` }],
        isError: true
      };
    }
  });