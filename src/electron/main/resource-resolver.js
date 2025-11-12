import { app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resource resolver for Electron app
 * Handles both development and production resource paths
 */
class ResourceResolver {
  constructor() {
    // Determine if running in development or production
    this.isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    
    // Base paths for different environments
    if (this.isDev) {
      // In development, use project root
      this.projectRoot = path.join(__dirname, '../../..');
      this.resourcesPath = this.projectRoot;
    } else {
      // In production, use packaged resources
      // For files in app.asar.unpacked, we need to check both locations
      this.projectRoot = process.resourcesPath;
      this.resourcesPath = process.resourcesPath;
      
      // Store the unpacked path for WASM and binary files
      const appPath = app.getAppPath();
      this.unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    }
    
    console.log(`ResourceResolver initialized: isDev=${this.isDev}, resourcesPath=${this.resourcesPath}`);
    
    // In production, list what's actually in the resources directory
    if (!this.isDev && fs.existsSync(this.resourcesPath)) {
      console.log('[ResourceResolver] Contents of resourcesPath:');
      try {
        const contents = fs.readdirSync(this.resourcesPath);
        contents.forEach(item => {
          const itemPath = path.join(this.resourcesPath, item);
          const stats = fs.statSync(itemPath);
          console.log(`  ${stats.isDirectory() ? '[DIR]' : '[FILE]'} ${item}`);
          
          // If it's src directory, list its contents
          if (item === 'src' && stats.isDirectory()) {
            try {
              const srcContents = fs.readdirSync(itemPath);
              srcContents.forEach(srcItem => {
                const srcItemPath = path.join(itemPath, srcItem);
                const srcStats = fs.statSync(srcItemPath);
                console.log(`    ${srcStats.isDirectory() ? '[DIR]' : '[FILE]'} ${srcItem}`);
              });
            } catch (e) {
              console.log(`    Error reading src: ${e.message}`);
            }
          }
        });
        
        // Also check unpacked directory
        if (this.unpackedPath && fs.existsSync(this.unpackedPath)) {
          console.log('[ResourceResolver] Contents of app.asar.unpacked:');
          const unpackedContents = fs.readdirSync(this.unpackedPath);
          unpackedContents.forEach(item => {
            console.log(`  [UNPACKED] ${item}`);
          });
        }
      } catch (e) {
        console.log(`  Error listing directory: ${e.message}`);
      }
    }
  }

  /**
   * Resolve a resource path
   * @param {string} relativePath - Path relative to project root
   * @returns {string} Absolute path to resource
   */
  resolve(relativePath) {
    // In production, check if file is in unpacked directory first (for WASM files)
    if (!this.isDev && this.unpackedPath) {
      const unpackedFile = path.join(this.unpackedPath, relativePath);
      if (fs.existsSync(unpackedFile)) {
        console.log(`[ResourceResolver] Found in unpacked: '${relativePath}' -> '${unpackedFile}'`);
        return unpackedFile;
      }
    }
    
    const resolved = path.join(this.resourcesPath, relativePath);
    
    if (this.isDev) {
      // In development, verify file exists and warn if not
      if (!fs.existsSync(resolved)) {
        console.warn(`Development resource not found: ${resolved}`);
      }
    } else {
      // In production, log the resolved path for debugging
      console.log(`[ResourceResolver] Resolved '${relativePath}' to '${resolved}'`);
    }
    
    return resolved;
  }

  /**
   * Read a text resource file
   * @param {string} relativePath - Path relative to project root
   * @param {string} encoding - File encoding (default: 'utf-8')
   * @returns {string} File contents
   */
  readText(relativePath, encoding = 'utf-8') {
    const filePath = this.resolve(relativePath);
    
    // Debug logging for production issues
    if (!this.isDev) {
      console.log(`[ResourceResolver] Reading text file: ${filePath}`);
      console.log(`[ResourceResolver] File exists: ${fs.existsSync(filePath)}`);
    }
    
    try {
      return fs.readFileSync(filePath, encoding);
    } catch (error) {
      console.error(`[ResourceResolver] Failed to read '${relativePath}' from '${filePath}': ${error.message}`);
      throw new Error(`Failed to read resource '${relativePath}': ${error.message}`);
    }
  }

  /**
   * Read a binary resource file
   * @param {string} relativePath - Path relative to project root
   * @returns {Buffer} File contents as Buffer
   */
  readBinary(relativePath) {
    const filePath = this.resolve(relativePath);
    try {
      return fs.readFileSync(filePath);
    } catch (error) {
      throw new Error(`Failed to read resource '${relativePath}': ${error.message}`);
    }
  }

  /**
   * Check if a resource exists
   * @param {string} relativePath - Path relative to project root
   * @returns {boolean} True if resource exists
   */
  exists(relativePath) {
    const filePath = this.resolve(relativePath);
    return fs.existsSync(filePath);
  }

  /**
   * Get all resources in a directory
   * @param {string} relativePath - Directory path relative to project root
   * @param {string} pattern - Optional glob pattern (e.g., '*.pl')
   * @returns {string[]} Array of absolute file paths
   */
  listResources(relativePath, pattern = '*') {
    const dirPath = this.resolve(relativePath);
    
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = fs.readdirSync(dirPath);
    
    if (pattern === '*') {
      return files.map(f => path.join(dirPath, f));
    }

    // Simple pattern matching (e.g., '*.pl')
    const regex = new RegExp(pattern.replace('*', '.*').replace('.', '\\.'));
    return files
      .filter(f => regex.test(f))
      .map(f => path.join(dirPath, f));
  }

  /**
   * Get path for a DML core file
   * @param {string} filename - Prolog filename (e.g., 'cmdline.pl')
   * @returns {string} Absolute path to file
   */
  getDmlCorePath(filename) {
    return this.resolve(`src/dml-core/${filename}`);
  }

  /**
   * Read a DML core file
   * @param {string} filename - Prolog filename
   * @returns {string} File contents
   */
  readDmlCore(filename) {
    return this.readText(`src/dml-core/${filename}`);
  }

  /**
   * Get path for V86 image
   * @param {string} filename - Image filename (e.g., 'alpine.img')
   * @returns {string} Absolute path to image
   */
  getV86ImagePath(filename) {
    return this.resolve(`vendor/v86/images/${filename}`);
  }

  getV86WasmPath() {
    return this.resolve('vendor/v86/build/v86.wasm');
  }


  getV86BiosPath(filename) {
    return this.resolve(`vendor/v86/bios/${filename}`);
  }

  /**
   * Get info about current environment
   * @returns {object} Environment info
   */
  getInfo() {
    return {
      isDev: this.isDev,
      projectRoot: this.projectRoot,
      resourcesPath: this.resourcesPath,
      isPackaged: app.isPackaged,
      processResourcesPath: process.resourcesPath
    };
  }
}

// Create singleton instance
const resourceResolver = new ResourceResolver();

export default resourceResolver;
export { ResourceResolver };
