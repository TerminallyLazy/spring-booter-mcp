this.server.tool('check_unsloth_installation', z.object({}).shape, async (params) => {
    /** Verify if Unsloth is properly installed and configured in the environment */
    try {
      const { stdout, stderr } = await execPromise('python -c "import unsloth; print(\'Unsloth version: \' + unsloth.__version__)"');
      
      if (stderr && !stdout) {
        return {
          content: [{ type: 'text', text: 'Error checking Unsloth installation: ' + stderr }],
          isError: true
        };
      }
      
      return {
        content: [{ type: 'text', text: stdout.trim() }]
      };
    } catch (error) {
      console.error('Error in check_unsloth_installation tool:', error);
      return {
        content: [{ type: 'text', text: 'Unsloth is not installed. Please install it with: pip install unsloth' }],
        isError: true
      };
    }
  });