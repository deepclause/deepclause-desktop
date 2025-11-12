import fs from 'fs';
import path from 'path';

/**
 * Parse parameter type from key string
 * Supports formats like:
 *   - "key:file" -> { name: "key", type: "file" }
 *   - "key:select(opt1, opt2, opt3)" -> { name: "key", type: "select", options: ["opt1", "opt2", "opt3"] }
 *   - "key:multiselect(opt1, opt2)" -> { name: "key", type: "multiselect", options: ["opt1", "opt2"] }
 *   - "key" -> { name: "key", type: "text" }
 */
export function parseParameterType(keyString) {
    // Check for type suffix
    const typeMatch = keyString.match(/^([^:]+):(.+)$/);
    
    if (!typeMatch) {
        // No type specified, default to text
        return { name: keyString, type: 'text' };
    }
    
    const [, name, typeSpec] = typeMatch;
    
    // Check for select/multiselect with options
    const selectMatch = typeSpec.match(/^(select|multiselect)\(([^)]+)\)$/);
    
    if (selectMatch) {
        const [, type, optionsStr] = selectMatch;
        // Parse options, trim whitespace
        const options = optionsStr.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
        return { name, type, options };
    }
    
    // Simple type (file, text, etc.)
    return { name, type: typeSpec };
}

/**
 * Analyze DML parameters from param/3 predicates
 */
export function analyzeDmlParameters(dmlCode) {
    const parameters = [];
    const seenKeys = new Set();
    try {
        // Pattern to match param("key", "description", Var) or param('key', 'description', Var)
        const paramPattern = /param\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/gi;
        let match;
        while ((match = paramPattern.exec(dmlCode)) !== null) {
            const [, key, description, variable] = match;
            if (!seenKeys.has(key)) {
                // Parse the parameter type from the key
                const typeInfo = parseParameterType(key);
                parameters.push({ 
                    key, 
                    description, 
                    variable,
                    // Add parsed type information
                    name: typeInfo.name,
                    type: typeInfo.type,
                    options: typeInfo.options
                });
                seenKeys.add(key);
            }
        }
    } catch (error) {}
    return parameters;
}

/**
 * Format parameter information for display
 */
export function formatParametersInfo(parameters) {
    if (!parameters || parameters.length === 0) {
        return "No parameters";
    }
    let info = "Parameters:\n";
    for (const param of parameters) {
        info += `  • ${param.key}: ${param.description}\n`;
    }
    return info.trim();
}

/**
 * Read the contents of a DML file and extract parameters
 */
export function readDmlFileContents(filename, examplesDir = "./dml_examples") {
    if (!filename.endsWith('.dml')) {
        filename += '.dml';
    }
    const filepath = path.join(examplesDir, filename);
    if (!fs.existsSync(filepath)) {
        throw new Error(`File not found: ${filepath}`);
    }
    const content = fs.readFileSync(filepath, 'utf-8');
    const parameters = analyzeDmlParameters(content);
    return { content, parameters };
}

/**
 * List all DML files in a directory recursively, returning a tree structure
 */
export function listDmlFiles(examplesDir = "./dml_examples") {
    const files = [];
    
    function scanDirectory(dir, relativePath = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
            
            if (entry.isDirectory()) {
                // Recursively scan subdirectories
                scanDirectory(fullPath, relPath);
            } else if (entry.isFile() && entry.name.endsWith('.dml')) {
                // Store relative path without .dml extension for display
                const nameWithoutExt = relPath.slice(0, -4);
                files.push({
                    name: entry.name,
                    path: nameWithoutExt,
                    relativePath: relPath,
                    fullPath: fullPath
                });
            }
        }
    }
    
    scanDirectory(examplesDir);
    return files;
}

/**
 * Build a tree structure from flat file list
 */
export function buildDmlFileTree(files) {
    const tree = { name: 'root', children: [], files: [] };
    
    for (const file of files) {
        const parts = file.path.split(path.sep);
        let current = tree;
        
        // Navigate/create directory structure
        for (let i = 0; i < parts.length - 1; i++) {
            const dirName = parts[i];
            let child = current.children.find(c => c.name === dirName);
            if (!child) {
                child = { name: dirName, children: [], files: [] };
                current.children.push(child);
            }
            current = child;
        }
        
        // Add file to the appropriate directory
        current.files.push({
            name: parts[parts.length - 1],
            path: file.path,
            relativePath: file.relativePath
        });
    }
    
    return tree;
}
