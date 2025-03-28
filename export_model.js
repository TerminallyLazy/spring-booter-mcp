this.server.tool('export_model', z.object({
    modelPath: z.string().describe('Path to the fine-tuned model'),
    exportFormat: z.enum(['gguf', 'huggingface']).describe('Format to export to (gguf, huggingface)'),
    outputPath: z.string().describe('Path to save the exported model'),
    quantizationBits: z.number().optional().describe('Bits for quantization for GGUF export (default: 4)')
  }).shape, async (params) => {
    /** Export a fine-tuned Unsloth model to various formats for deployment */
    try {
      const {
        modelPath,
        exportFormat,
        outputPath,
        quantizationBits = 4
      } = params;
      
      let script = '';
      
      if (exportFormat === 'gguf') {
        script = `
  import json
  import os
  try:
      from transformers import AutoModelForCausalLM, AutoTokenizer
      import torch
      
      # Create output directory if it doesn't exist
      os.makedirs(os.path.dirname("${outputPath}"), exist_ok=True)
      
      # Load the model and tokenizer
      model = AutoModelForCausalLM.from_pretrained("${modelPath}")
      tokenizer = AutoTokenizer.from_pretrained("${modelPath}")
      
      # Save the model in GGUF format
      from transformers import LlamaForCausalLM
      import ctranslate2
      
      # Convert to GGUF format
      ct_model = ctranslate2.converters.TransformersConverter(
          "${modelPath}",
          "${outputPath}",
          quantization="int${quantizationBits}"
      ).convert()
      
      print(json.dumps({
          "success": True,
          "model_path": "${modelPath}",
          "export_format": "gguf",
          "output_path": "${outputPath}",
          "quantization_bits": ${quantizationBits}
      }))
  except Exception as e:
      print(json.dumps({"error": str(e), "success": False}))
  `;
      } else if (exportFormat === 'huggingface') {
        script = `
  import json
  import os
  try:
      from transformers import AutoModelForCausalLM, AutoTokenizer
      
      # Create output directory if it doesn't exist
      os.makedirs("${outputPath}", exist_ok=True)
      
      # Load the model and tokenizer
      model = AutoModelForCausalLM.from_pretrained("${modelPath}")
      tokenizer = AutoTokenizer.from_pretrained("${modelPath}")
      
      # Save the model in Hugging Face format
      model.save_pretrained("${outputPath}")
      tokenizer.save_pretrained("${outputPath}")
      
      print(json.dumps({
          "success": True,
          "model_path": "${modelPath}",
          "export_format": "huggingface",
          "output_path": "${outputPath}"
      }))
  except Exception as e:
      print(json.dumps({"error": str(e), "success": False}))
  `;
      } else {
        return {
          content: [{ 
            type: 'text', 
            text: `Export format '${exportFormat}' is not supported. Currently, only 'gguf' and 'huggingface' formats are supported.`
          }],
          isError: true
        };
      }
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error exporting model: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const exportResult = JSON.parse(stdout);
        if (!exportResult.success) {
          throw new Error(exportResult.error);
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: `Successfully exported model to ${exportFormat} format:\n\n- Model: ${modelPath}\n- Output: ${outputPath}${exportFormat === 'gguf' ? `\n- Quantization: ${quantizationBits}-bit` : ''}`
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error exporting model: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in export_model tool:', error);
      return {
        content: [{ type: 'text', text: `Error exporting model: ${error.message}` }],
        isError: true
      };
    }
  });