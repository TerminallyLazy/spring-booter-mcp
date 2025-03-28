this.server.tool('finetune_model', z.object({
    modelName: z.string().describe('Name of the model to fine-tune'),
    datasetName: z.string().describe('Name of the dataset to use for fine-tuning'),
    outputDir: z.string().describe('Directory to save the fine-tuned model'),
    maxSeqLength: z.number().optional().describe('Maximum sequence length for training (default: 2048)'),
    loraRank: z.number().optional().describe('Rank for LoRA fine-tuning (default: 16)'),
    loraAlpha: z.number().optional().describe('Alpha for LoRA fine-tuning (default: 16)'),
    batchSize: z.number().optional().describe('Batch size for training (default: 2)'),
    gradientAccumulationSteps: z.number().optional().describe('Number of gradient accumulation steps (default: 4)'),
    learningRate: z.number().optional().describe('Learning rate for training (default: 2e-4)'),
    maxSteps: z.number().optional().describe('Maximum number of training steps (default: 100)'),
    datasetTextField: z.string().optional().describe('Field in the dataset containing the text (default: "text")'),
    loadIn4bit: z.boolean().optional().describe('Whether to use 4-bit quantization (default: true)')
  }).shape, async (params) => {
    /** Fine-tune a model with Unsloth optimizations using LoRA/QLoRA techniques */
    try {
      const {
        modelName,
        datasetName,
        outputDir,
        maxSeqLength = 2048,
        loraRank = 16,
        loraAlpha = 16,
        batchSize = 2,
        gradientAccumulationSteps = 4,
        learningRate = 2e-4,
        maxSteps = 100,
        datasetTextField = 'text',
        loadIn4bit = true
      } = params;
      
      const script = `
  import json
  import os
  try:
      from unsloth import FastLanguageModel
      from datasets import load_dataset
      from trl import SFTTrainer, SFTConfig
      import torch
      
      # Create output directory if it doesn't exist
      os.makedirs("${outputDir}", exist_ok=True)
      
      # Load the model
      model, tokenizer = FastLanguageModel.from_pretrained(
          model_name="${modelName}",
          max_seq_length=${maxSeqLength},
          load_in_4bit=${loadIn4bit ? 'True' : 'False'},
          use_gradient_checkpointing="unsloth"
      )
      
      # Load the dataset
      dataset = load_dataset("${datasetName}")
      
      # Patch the model with LoRA
      model = FastLanguageModel.get_peft_model(
          model,
          r=${loraRank},
          target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
          lora_alpha=${loraAlpha},
          use_gradient_checkpointing="unsloth",
          random_state=3407,
          max_seq_length=${maxSeqLength},
          use_rslora=False,
          loftq_config=None
      )
      
      # Configure the trainer
      trainer = SFTTrainer(
          model=model,
          train_dataset=dataset["train"],
          tokenizer=tokenizer,
          args=SFTConfig(
              dataset_text_field="${datasetTextField}",
              max_seq_length=${maxSeqLength},
              per_device_train_batch_size=${batchSize},
              gradient_accumulation_steps=${gradientAccumulationSteps},
              warmup_steps=10,
              max_steps=${maxSteps},
              learning_rate=${learningRate},
              logging_steps=1,
              output_dir="${outputDir}",
              optim="adamw_8bit",
              seed=3407,
          ),
      )
      
      # Train the model
      trainer.train()
      
      # Save the model
      trainer.save_model()
      
      print(json.dumps({
          "success": True,
          "output_dir": "${outputDir}",
          "model_name": "${modelName}",
          "dataset_name": "${datasetName}",
          "max_steps": ${maxSteps}
      }))
  except Exception as e:
      print(json.dumps({"error": str(e), "success": False}))
  `;
      
      const { stdout, stderr } = await execPromise(`python -c "${script}"`);
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error fine-tuning model: ' + stderr }],
          isError: true
        };
      }
      
      try {
        const trainingResult = JSON.parse(stdout);
        if (!trainingResult.success) {
          throw new Error(trainingResult.error);
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: `Successfully fine-tuned model: ${modelName} with dataset: ${datasetName}\n\nTraining Details:\n- Model: ${modelName}\n- Dataset: ${datasetName}\n- Output Directory: ${outputDir}\n- Training Steps: ${maxSteps}\n- Batch Size: ${batchSize}\n- Learning Rate: ${learningRate}\n- LoRA Rank: ${loraRank}`
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fine-tuning model: ${error.message}` }],
          isError: true
        };
      }
    } catch (error) {
      console.error('Error in finetune_model tool:', error);
      return {
        content: [{ type: 'text', text: `Error fine-tuning model: ${error.message}` }],
        isError: true
      };
    }
  });