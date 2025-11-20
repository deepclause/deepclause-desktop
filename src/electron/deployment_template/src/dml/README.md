# DML Deployment Template

This is a placeholder DML file. It will be replaced with the actual DML file during deployment generation.

## How It Works

When a user clicks "Deploy" on a DML file in the main DeepClause application:

1. This template folder is copied to the chosen output directory
2. The selected DML file is copied to `src/dml/`
3. All placeholder values are replaced:
   - `{{DEPLOYMENT_NAME}}` → User-chosen deployment name
   - `{{DML_FILE_NAME}}` → Name of the DML file
   - `{{DML_DESCRIPTION}}` → Description from the DML file
   - `{{PARAMETERS_JSON}}` → JSON array of parameter definitions
   - `{{PARAMETERS_LIST}}` → Markdown-formatted parameter list

4. The deployment is ready to be installed and run:
   ```bash
   npm install
   npm run dev
   ```

## Example DML File

```prolog
% Example: Data Analysis DML
% This file performs data analysis on a CSV file

agent_main :-
    param("input_file:file", "CSV file to analyze", InputFile),
    param("analysis_type:select(Summary, Detailed, Custom)", "Type of analysis", AnalysisType),
    param("output_format:select(Text, JSON, HTML)", "Output format", OutputFormat),
    
    % Read and analyze the file
    log("Analyzing file: ~w", [InputFile]),
    log("Analysis type: ~w", [AnalysisType]),
    
    % Perform analysis logic here
    yield("Analysis complete!").
```

## Generated Parameters

The parameters will be automatically extracted from the DML file and rendered in the web form.
