import { BrowserWindow } from 'electron';

/**
 * Mermaid Validator using Electron's built-in Chromium
 * This creates a hidden browser window to validate Mermaid diagrams
 * 
 * IMPORTANT: Uses offscreen rendering to avoid interfering with the main window
 */
class MermaidValidator {
    constructor() {
        this.validatorWindow = null;
        this.initPromise = null;
    }

    /**
     * Initialize the hidden validation window
     */
    async initialize() {
        // Return existing initialization promise if already in progress
        if (this.initPromise) {
            return this.initPromise;
        }

        if (this.validatorWindow && !this.validatorWindow.isDestroyed()) {
            return; // Already initialized
        }

        this.initPromise = (async () => {
            try {
                this.validatorWindow = new BrowserWindow({
                    show: false, // Hidden window
                    width: 800,
                    height: 600,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true,
                        offscreen: true, // Use offscreen rendering to avoid interference
                    },
                    // Prevent window from taking focus
                    skipTaskbar: true,
                    focusable: false,
                });

                // Prevent any interference with main window
                this.validatorWindow.setIgnoreMouseEvents(true);

                // Load a minimal HTML page with Mermaid
                const html = `
<!DOCTYPE html>
<html>
<head>
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
        
        mermaid.initialize({ 
            startOnLoad: false,
            securityLevel: 'loose'
        });

        // Make mermaid available globally for executeJavaScript calls
        window.mermaidReady = true;
        window.validateMermaid = async (code) => {
            try {
                const result = await mermaid.parse(code);
                return { valid: true, result };
            } catch (error) {
                return { valid: false, error: error.message };
            }
        };
    </script>
</head>
<body>
    <div id="validator">Mermaid Validator Ready</div>
</body>
</html>
                `;

                await this.validatorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
                
                // Wait for mermaid to be ready
                await this.waitForReady();
                
                console.log('✅ Mermaid validator window initialized (offscreen)');
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    /**
     * Wait for the validator to be ready
     */
    async waitForReady(maxAttempts = 20) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const ready = await this.validatorWindow.webContents.executeJavaScript('window.mermaidReady || false');
                if (ready) {
                    return;
                }
            } catch (error) {
                // Window not ready yet
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Validator window failed to initialize');
    }

    /**
     * Validate Mermaid code
     * @param {string} code - Mermaid diagram code
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    async validate(code) {
        let shouldCleanup = false;
        
        try {
            if (!this.validatorWindow || this.validatorWindow.isDestroyed()) {
                await this.initialize();
                shouldCleanup = true; // Clean up if we created it for this validation
            }

            // Execute validation directly in the renderer process
            // This is simpler and less likely to cause issues than message passing
            const result = await Promise.race([
                this.validatorWindow.webContents.executeJavaScript(
                    `window.validateMermaid(${JSON.stringify(code)})`
                ),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Validation timeout')), 5000)
                )
            ]);

            return result;
        } catch (error) {
            console.debug('Mermaid validation error:', error.message);
            return { valid: false, error: error.message };
        } finally {
            // Always destroy the window after validation to prevent interference
            if (shouldCleanup || true) { // Force cleanup every time
                this.destroy();
            }
        }
    }

    /**
     * Clean up the validator window
     */
    destroy() {
        if (this.validatorWindow && !this.validatorWindow.isDestroyed()) {
            this.validatorWindow.destroy();
            this.validatorWindow = null;
        }
        this.initPromise = null;
    }
}

// Export singleton instance
export const mermaidValidator = new MermaidValidator();
