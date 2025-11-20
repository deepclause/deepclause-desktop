import { Code, Copy, Check, X } from 'lucide-react';
import { useState } from 'react';
import { config } from '../config';

interface ApiDocsProps {
  dmlFileName: string;
  parameters: Array<{
    key: string;
    name: string;
    description: string;
    type: string;
    options?: string[];
  }>;
  onClose: () => void;
}

export default function ApiDocs({ dmlFileName, parameters, onClose }: ApiDocsProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const apiEndpoint = config.apiEndpoint || 'http://localhost:3001';

  // Generate example parameters
  const exampleParams: Record<string, any> = {};
  parameters.forEach(param => {
    if (param.type === 'file') {
      exampleParams[param.key] = 'uploaded-file.pdf';
    } else if (param.type === 'boolean') {
      exampleParams[param.key] = true;
    } else if (param.type === 'number') {
      exampleParams[param.key] = 42;
    } else if (param.type === 'multiselect') {
      exampleParams[param.key] = param.options ? [param.options[0]] : ['option1'];
    } else if (param.type === 'select') {
      exampleParams[param.key] = param.options ? param.options[0] : 'option1';
    } else {
      exampleParams[param.key] = `example ${param.name.toLowerCase()}`;
    }
  });

  const curlExample = `# Execute DML (non-streaming)
curl -X POST ${apiEndpoint}/api/execute \\
  -H "Content-Type: application/json" \\
  -d '{
  "dmlFile": "${dmlFileName}",
  "parameters": ${JSON.stringify(exampleParams, null, 2).split('\n').join('\n  ')},
  "streamResults": false,
  "sessionId": "my-session-123"
}'`;

  const curlStreamExample = `# Execute DML (streaming)
curl -X POST ${apiEndpoint}/api/execute \\
  -H "Content-Type: application/json" \\
  -d '{
  "dmlFile": "${dmlFileName}",
  "parameters": ${JSON.stringify(exampleParams, null, 2).split('\n').join('\n  ')},
  "streamResults": true,
  "sessionId": "my-session-456"
}'`;

  const fileUploadExample = parameters.some(p => p.type === 'file') ? `# Upload a file (required for file parameters)
curl -X POST "${apiEndpoint}/api/upload?sessionId=my-session-123" \\
  -F "file=@/path/to/your/file.pdf"

# Response:
# {
#   "success": true,
#   "filename": "file.pdf",
#   "originalName": "file.pdf",
#   "size": 12345
# }` : '';

  const pythonExample = `import requests
import json

# API endpoint
api_endpoint = "${apiEndpoint}"

${parameters.some(p => p.type === 'file') ? `# Step 1: Upload file (if needed)
session_id = "my-session-123"
with open("/path/to/your/file.pdf", "rb") as f:
    upload_response = requests.post(
        f"{api_endpoint}/api/upload",
        params={"sessionId": session_id},
        files={"file": f}
    )
    uploaded_file = upload_response.json()["filename"]
    print(f"Uploaded: {uploaded_file}")

# Step 2: Execute DML with uploaded file
` : `# Execute DML
session_id = "my-session-123"
`}response = requests.post(
    f"{api_endpoint}/api/execute",
    json={
        "dmlFile": "${dmlFileName}",
        "parameters": ${JSON.stringify(exampleParams, null, 2).split('\n').join('\n        ')},
        "streamResults": False,
        "sessionId": session_id
    }
)

result = response.json()
print(result["output"])

# Cleanup session workspace
requests.post(
    f"{api_endpoint}/api/cleanup-session",
    json={"sessionId": session_id}
)`;

  const jsExample = `// Using fetch API
const apiEndpoint = '${apiEndpoint}';

${parameters.some(p => p.type === 'file') ? `// Step 1: Upload file (if needed)
const sessionId = 'my-session-' + Date.now();
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const uploadResponse = await fetch(
  \`\${apiEndpoint}/api/upload?sessionId=\${sessionId}\`,
  { method: 'POST', body: formData }
);
const { filename } = await uploadResponse.json();

// Step 2: Execute DML with uploaded file
` : `// Execute DML
const sessionId = 'my-session-' + Date.now();
`}const response = await fetch(\`\${apiEndpoint}/api/execute\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dmlFile: '${dmlFileName}',
    parameters: ${JSON.stringify(exampleParams, null, 2).split('\n').join('\n    ')},
    streamResults: false,
    sessionId: sessionId
  })
});

const result = await response.json();
console.log(result.output);

// Cleanup session workspace
await fetch(\`\${apiEndpoint}/api/cleanup-session\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId })
});`;

  const CodeBlock = ({ code, language, section }: { code: string; language: string; section: string }) => (
    <div className="relative">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">{language}</span>
        <button
          onClick={() => copyToClipboard(code, section)}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Copy to clipboard"
        >
          {copiedSection === section ? (
            <Check className="w-4 h-4 text-green-400" />
          ) : (
            <Copy className="w-4 h-4 text-gray-400" />
          )}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Code className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">API Documentation</h2>
              <p className="text-sm text-gray-600">How to execute this DML programmatically</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Endpoints */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Available Endpoints</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <code className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono text-xs">POST</code>
                <div>
                  <code className="text-gray-900">/api/execute</code>
                  <p className="text-gray-600 mt-1">Execute the DML file with parameters</p>
                </div>
              </div>
              {parameters.some(p => p.type === 'file') && (
                <div className="flex items-start gap-2">
                  <code className="bg-green-50 text-green-700 px-2 py-1 rounded font-mono text-xs">POST</code>
                  <div>
                    <code className="text-gray-900">/api/upload</code>
                    <p className="text-gray-600 mt-1">Upload files before execution</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2">
                <code className="bg-purple-50 text-purple-700 px-2 py-1 rounded font-mono text-xs">POST</code>
                <div>
                  <code className="text-gray-900">/api/cleanup-session</code>
                  <p className="text-gray-600 mt-1">Clean up session workspace after execution</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <code className="bg-gray-50 text-gray-700 px-2 py-1 rounded font-mono text-xs">GET</code>
                <div>
                  <code className="text-gray-900">/api/metadata</code>
                  <p className="text-gray-600 mt-1">Get DML metadata and parameters</p>
                </div>
              </div>
            </div>
          </section>

          {/* cURL Examples */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">cURL Examples</h3>
            <div className="space-y-4">
              {fileUploadExample && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">File Upload</h4>
                  <CodeBlock code={fileUploadExample} language="bash" section="curl-upload" />
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Execute (Non-Streaming)</h4>
                <CodeBlock code={curlExample} language="bash" section="curl-execute" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Execute (Streaming)</h4>
                <CodeBlock code={curlStreamExample} language="bash" section="curl-stream" />
              </div>
            </div>
          </section>

          {/* Python Example */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Python Example</h3>
            <CodeBlock code={pythonExample} language="python" section="python" />
          </section>

          {/* JavaScript Example */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">JavaScript Example</h3>
            <CodeBlock code={jsExample} language="javascript" section="javascript" />
          </section>

          {/* Parameters Reference */}
          {parameters.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Parameters Reference</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {parameters.map((param) => (
                      <tr key={param.key}>
                        <td className="px-4 py-3 text-sm font-mono text-gray-900">{param.key}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                            {param.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{param.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Notes */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Notes</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2 text-sm text-blue-900">
              <p>• Use unique <code className="bg-blue-100 px-1 rounded">sessionId</code> for each execution to ensure workspace isolation</p>
              <p>• For file parameters, upload files first using <code className="bg-blue-100 px-1 rounded">/api/upload</code> before executing</p>
              <p>• Pass the filename (not path) in parameters after uploading</p>
              <p>• Set <code className="bg-blue-100 px-1 rounded">streamResults: true</code> for real-time output streaming</p>
              <p>• Call <code className="bg-blue-100 px-1 rounded">/api/cleanup-session</code> after execution to free disk space</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
