# Learned DML Examples

This folder contains DML (DeepClause Meta Language) examples that are used by the AI system to learn how to generate new DML code.

## Purpose

When you ask DeepClause to generate DML code from a natural language description, the system uses the examples in this folder as training data to understand:
- The syntax and structure of DML
- Common patterns and idioms
- How to solve various types of problems
- Best practices for writing DML code

## How It Works

The `generateDmlFromPrompt()` function analyzes the examples here to learn:
1. **Pattern Recognition**: Understanding common DML constructs and their usage
2. **Problem-Solving Approaches**: Learning different strategies for different types of tasks
3. **Code Structure**: Maintaining consistent style and organization
4. **Parameter Handling**: How to define and use parameters effectively

## Adding Examples

You can add your own DML examples to this folder to improve the AI's ability to generate code:
1. Save well-tested DML files here that demonstrate useful patterns
2. Include clear comments explaining what the code does
3. Use descriptive parameter names with proper documentation
4. Keep examples focused on a single concept or task

## Best Practices

- **Focused Examples**: Each file should demonstrate one clear concept
- **Well-Commented**: Add explanatory comments for complex logic
- **Tested Code**: Only include examples that work correctly
- **Diverse Patterns**: Include various types of tasks (data processing, logic, I/O, etc.)
- **Clean Code**: Use consistent formatting and naming conventions

## Note

This folder is automatically created when DeepClause starts for the first time. You can safely add, modify, or remove examples as needed to customize the AI's learning base.
