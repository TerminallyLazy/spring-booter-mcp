this.server.tool('create_spring_boot_mcp_project', z.object({
    projectName: z.string().describe('Name of the project'),
    packageName: z.string().describe('Base package name (e.g., "com.example.mcp")'),
    springBootVersion: z.string().optional().describe('Spring Boot version (default: "3.2.0")'),
    springAiVersion: z.string().optional().describe('Spring AI version (default: "1.0.0")'),
    serverType: z.enum(['STDIO', 'WEBMVC', 'WEBFLUX']).optional().describe('MCP server transport type (default: "WEBMVC")'),
    asyncMode: z.boolean().optional().describe('Whether to use async mode for the MCP server (default: false)')
  }).shape, async (params) => {
    /** Generate a Spring Boot project with MCP server and Unsloth integration */
    try {
      const {
        projectName,
        packageName,
        springBootVersion = '3.2.0',
        springAiVersion = '1.0.0',
        serverType = 'WEBMVC',
        asyncMode = false
      } = params;
      
      // Generate pom.xml
      const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
  <project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
      <modelVersion>4.0.0</modelVersion>
      <parent>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-starter-parent</artifactId>
          <version>${springBootVersion}</version>
          <relativePath/> <!-- lookup parent from repository -->
      </parent>
      <groupId>${packageName}</groupId>
      <artifactId>${projectName}</artifactId>
      <version>0.0.1-SNAPSHOT</version>
      <name>${projectName}</name>
      <description>Spring Boot MCP Server with Unsloth Integration</description>
      <properties>
          <java.version>17</java.version>
          <spring-ai.version>${springAiVersion}</spring-ai.version>
      </properties>
      <dependencies>
          <!-- Spring Boot Starters -->
          <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter</artifactId>
          </dependency>
  ${serverType === 'WEBMVC' ? `		<dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
          </dependency>
  ` : serverType === 'WEBFLUX' ? `		<dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-webflux</artifactId>
          </dependency>
  ` : ''}
          <!-- Spring AI MCP Server -->
          <dependency>
              <groupId>org.springframework.ai</groupId>
              <artifactId>spring-ai-starter-mcp-server${serverType !== 'STDIO' ? '-' + serverType.toLowerCase() : ''}</artifactId>
          </dependency>
  
          <!-- Spring AI Vector Store -->
          <dependency>
              <groupId>org.springframework.ai</groupId>
              <artifactId>spring-ai-starter-vector-store-pgvector</artifactId>
          </dependency>
  
          <!-- Spring AI Embedding Model -->
          <dependency>
              <groupId>org.springframework.ai</groupId>
              <artifactId>spring-ai-starter-model-openai</artifactId>
          </dependency>
  
          <!-- Database -->
          <dependency>
              <groupId>org.postgresql</groupId>
              <artifactId>postgresql</artifactId>
              <scope>runtime</scope>
          </dependency>
  
          <!-- Development Tools -->
          <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-devtools</artifactId>
              <scope>runtime</scope>
              <optional>true</optional>
          </dependency>
          <dependency>
              <groupId>org.projectlombok</groupId>
              <artifactId>lombok</artifactId>
              <optional>true</optional>
          </dependency>
  
          <!-- Testing -->
          <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-test</artifactId>
              <scope>test</scope>
          </dependency>
  ${serverType === 'WEBFLUX' ? `		<dependency>
              <groupId>io.projectreactor</groupId>
              <artifactId>reactor-test</artifactId>
              <scope>test</scope>
          </dependency>
  ` : ''}
      </dependencies>
  
      <><dependencyManagement>
              <dependencies>
                  <dependency>
                      <groupId>org.springframework.ai</groupId>
                      <artifactId>spring-ai-bom</artifactId>
                      <version>${spring - ai.version}</version>
                      <type>pom</type>
                      <scope>import</scope>
                  </dependency>
              </dependencies>
          </dependencyManagement><build>
                  <plugins>
                      <plugin>
                          <groupId>org.springframework.boot</groupId>
                          <artifactId>spring-boot-maven-plugin</artifactId>
                          <configuration>
                              <excludes>
                                  <exclude>
                                      <groupId>org.projectlombok</groupId>
                                      <artifactId>lombok</artifactId>
                                  </exclude>
                              </excludes>
                          </configuration>
                      </plugin>
                  </plugins>
              </build></>
  
  </project>`;
      
      // Generate application.yml
      const applicationYml = `spring:
    ai:
      mcp:
        server:
          name: ${projectName}-mcp-server
          version: 1.0.0
          type: ${asyncMode ? 'ASYNC' : 'SYNC'},
  ${serverType !== 'STDIO' ? '        sse-message-endpoint: /mcp/messages' : ''},
  ${serverType === 'STDIO' ? '        stdio: true' : ''},
    datasource:
      url: jdbc:postgresql://localhost:5432/postgres
      username: postgres
      password: postgres
    ai:
      vectorstore:
        pgvector:
          index-type: HNSW
          distance-type: COSINE_DISTANCE
          dimensions: 1536
          initialize-schema: true
  
  logging:
    level:
      org.springframework.ai: INFO
      ${packageName}: DEBUG`;
      
      // Generate main application class
      const mainAppClass = `package ${packageName};
  
  import org.springframework.boot.SpringApplication;
  import org.springframework.boot.autoconfigure.SpringBootApplication;
  
  @SpringBootApplication
  public class ${projectName.charAt(0).toUpperCase() + projectName.slice(1).replace(/-([a-z])/g, g => g[1].toUpperCase())}Application {
  
      public static void main(String[] args) {
          SpringApplication.run(${projectName.charAt(0).toUpperCase() + projectName.slice(1).replace(/-([a-z])/g, g => g[1].toUpperCase())}Application.class, args);
      }
  
  }`;
      
      // Generate UnslothService class
      const unslothServiceClass = `package ${packageName}.service;
  
  import lombok.extern.slf4j.Slf4j;
  import org.springframework.ai.mcp.annotation.Tool;
  import org.springframework.stereotype.Service;
  
  import java.io.BufferedReader;
  import java.io.IOException;
  import java.io.InputStreamReader;
  import java.util.concurrent.TimeUnit;
  
  @Service
  @Slf4j
  public class UnslothService {
  
      @Tool(description = "Check if Unsloth is properly installed")
      public String checkUnslothInstallation() {
          try {
              Process process = Runtime.getRuntime().exec("python -c \"import unsloth; print('Unsloth version: ' + unsloth.__version__)\"");
              process.waitFor(10, TimeUnit.SECONDS);
              
              BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
              StringBuilder output = new StringBuilder();
              String line;
              while ((line = reader.readLine()) != null) {
                  output.append(line).append("\n");
              }
              
              if (output.length() > 0) {
                  return output.toString().trim();
              } else {
                  BufferedReader errorReader = new BufferedReader(new InputStreamReader(process.getErrorStream()));
                  StringBuilder errorOutput = new StringBuilder();
                  while ((line = errorReader.readLine()) != null) {
                      errorOutput.append(line).append("\n");
                  }
                  return "Error: " + errorOutput.toString().trim();
              }
          } catch (IOException | InterruptedException e) {
              log.error("Error checking Unsloth installation", e);
              return "Unsloth is not installed. Please install it with: pip install unsloth";
          }
      }
      
      @Tool(description = "List all models supported by Unsloth")
      public String listSupportedModels() {
          try {
              String script = """
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
                  """;
              
              Process process = Runtime.getRuntime().exec(String.format("python -c \"%s\"", script));
              process.waitFor(10, TimeUnit.SECONDS);
              
              BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
              StringBuilder output = new StringBuilder();
              String line;
              while ((line = reader.readLine()) != null) {
                  output.append(line);
              }
              
              return "Supported Unsloth Models:\n" + output.toString();
          } catch (IOException | InterruptedException e) {
              log.error("Error listing supported models", e);
              return "Error listing supported models: " + e.getMessage();
          }
      }
      
      @Tool(description = "Load a pretrained model with Unsloth optimizations")
      public String loadModel(String modelName, Integer maxSeqLength, Boolean loadIn4bit, Boolean useGradientCheckpointing) {
          // Default values
          maxSeqLength = maxSeqLength != null ? maxSeqLength : 2048;
          loadIn4bit = loadIn4bit != null ? loadIn4bit : true;
          useGradientCheckpointing = useGradientCheckpointing != null ? useGradientCheckpointing : true;
          
          try {
              String script = String.format("""
                  import json
                  try:
                      from unsloth import FastLanguageModel
                      
                      # Load the model
                      model, tokenizer = FastLanguageModel.from_pretrained(
                          model_name="%s",
                          max_seq_length=%d,
                          load_in_4bit=%s,
                          use_gradient_checkpointing=%s
                      )
                      
                      # Get model info
                      model_info = {
                          "model_name": "%s",
                          "max_seq_length": %d,
                          "load_in_4bit": %s,
                          "use_gradient_checkpointing": %s,
                          "vocab_size": tokenizer.vocab_size,
                          "model_type": model.config.model_type,
                          "success": True
                      }
                      
                      print(json.dumps(model_info))
                  except Exception as e:
                      print(json.dumps({"error": str(e), "success": False}))
                  """, 
                  modelName, 
                  maxSeqLength, 
                  loadIn4bit ? "True" : "False", 
                  useGradientCheckpointing ? "\"unsloth\"" : "False",
                  modelName,
                  maxSeqLength,
                  loadIn4bit ? "True" : "False",
                  useGradientCheckpointing ? "True" : "False"
              );
              
              Process process = Runtime.getRuntime().exec(String.format("python -c \"%s\"", script));
              process.waitFor(60, TimeUnit.SECONDS); // Loading models can take time
              
              BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
              StringBuilder output = new StringBuilder();
              String line;
              while ((line = reader.readLine()) != null) {
                  output.append(line);
              }
              
              return "Model Loading Result:\n" + output.toString();
          } catch (IOException | InterruptedException e) {
              log.error("Error loading model", e);
              return "Error loading model: " + e.getMessage();
          }
      }
      
      // Additional methods for fine-tuning, text generation, etc. would be implemented similarly
  }`;
      
      // Generate ToolConfig class
      const toolConfigClass = `package ${packageName}.config;
  
  import ${packageName}.service.UnslothService;
  import org.springframework.ai.mcp.tool.MethodToolCallbackProvider;
  import org.springframework.ai.mcp.tool.ToolCallbackProvider;
  import org.springframework.context.annotation.Bean;
  import org.springframework.context.annotation.Configuration;
  
  @Configuration
  public class ToolConfig {
  
      @Bean
      public ToolCallbackProvider unslothTools(UnslothService unslothService) {
          return MethodToolCallbackProvider.builder()
                  .toolObjects(unslothService)
                  .build();
      }
  }`;
      
      // Generate README.md
      const readmeMd = `# ${projectName}
  
  A Spring Boot application that integrates Spring AI's Model Context Protocol (MCP) server with Unsloth for efficient LLM fine-tuning.
  
  ## Features
  
  - Spring Boot ${springBootVersion}
  - Spring AI ${springAiVersion}
  - MCP Server with ${serverType} transport
  - ${asyncMode ? 'Asynchronous' : 'Synchronous'} MCP server mode
  - Unsloth integration for efficient LLM fine-tuning
  - PGVector for vector storage
  
  ## Prerequisites
  
  - Java 17+
  - Maven
  - Python 3.10-3.12
  - PostgreSQL with PGVector extension
  - NVIDIA GPU with CUDA support (recommended for Unsloth)
  
  ## Setup
  
  ### 1. Install Unsloth
  
  \`\`\`bash
  pip install unsloth
  \`\`\`
  
  ### 2. Set up PostgreSQL with PGVector
  
  \`\`\`bash
  docker run -it --rm --name postgres -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres pgvector/pgvector
  \`\`\`
  
  ### 3. Build and run the application
  
  \`\`\`bash
  mvn spring-boot:run
  \`\`\`
  
  ## Usage
  
  ### MCP Server Endpoints
  
  ${serverType !== 'STDIO' ? `- MCP Server: http://localhost:8080/mcp/messages
  ` : ''}
  
  ### Available Tools
  
  - **checkUnslothInstallation**: Verify if Unsloth is properly installed
  - **listSupportedModels**: List all models supported by Unsloth
  - **loadModel**: Load a pretrained model with Unsloth optimizations
  
  ## License
  
  MIT
  `;
      
      // Generate Docker Compose file
      const dockerComposeYml = `version: '3.8'
  
  services:
    postgres:
      image: pgvector/pgvector:latest
      environment:
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
        POSTGRES_DB: postgres
      ports:
        - "5432:5432"
      volumes:
        - postgres-data:/var/lib/postgresql/data
  
  volumes:
    postgres-data:`;
      // Generate project structure
      const projectStructure = {
        'pom.xml': pomXml,
        'src/main/resources/application.yml': applicationYml,
        [`src/main/java/${packageName.replace(/\./g, '/')}/${projectName.charAt(0).toUpperCase()}${projectName.slice(1).replace(/-([a-z])/g, g => g[1].toUpperCase())}Application.java`]: mainAppClass,
        [`src/main/java/${packageName.replace(/\./g, '/')}/service/UnslothService.java`]: unslothServiceClass,
        [`src/main/java/${packageName.replace(/\./g, '/')}/config/ToolConfig.java`]: toolConfigClass,
        'README.md': readmeMd,
        'docker-compose.yml': dockerComposeYml
      };
      
      // Format the response
      let response = `# Spring Boot MCP Server with Unsloth Integration\n\n`;
      response += `Project '${projectName}' has been generated with the following structure:\n\n`;
      
      for (const [path, _] of Object.entries(projectStructure)) {
        response += `- ${path}\n`;
      }
      
      response += `\n## Key Files\n\n`;
      response += `### pom.xml\n\n\`\`\`xml\n${pomXml}\n\`\`\`\n\n`;
      response += `### application.yml\n\n\`\`\`yaml\n${applicationYml}\n\`\`\`\n\n`;
      response += `### Main Application Class\n\n\`\`\`java\n${mainAppClass}\n\`\`\`\n\n`;
      response += `### Unsloth Service\n\n\`\`\`java\n${unslothServiceClass}\n\`\`\`\n\n`;
      response += `### Tool Configuration\n\n\`\`\`java\n${toolConfigClass}\n\`\`\`\n\n`;
      
      response += `## Getting Started\n\n`;
      response += `1. Install Unsloth: \`pip install unsloth\`\n`;
      response += `2. Start PostgreSQL with PGVector: \`docker-compose up -d\`\n`;
      response += `3. Build and run the application: \`mvn spring-boot:run\`\n`;
      
      return {
        content: [{ type: 'text', text: response }]
      };
    } catch (error) {
      console.error('Error in create_spring_boot_mcp_project tool:', error);
      return {
        content: [{ type: 'text', text: `Error creating Spring Boot MCP project: ${error.message}` }],
        isError: true
      };
    }
  });