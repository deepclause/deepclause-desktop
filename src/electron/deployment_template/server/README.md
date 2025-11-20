# DML Micro App Server

A standalone Node.js server for executing DML files in deployed micro applications.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Ensure DML runtime is available:
   - Copy the required DML bridge files from your DeepClause installation
   - The server expects `../dml-js/bridge.js` to be available

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Configuration

- **Port**: Set via `PORT` environment variable (default: 3001)
- **CORS**: Enabled for all origins (configure in `index.js` for production)

## API Endpoints

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dmlEngineAvailable": true
}
```

### POST /api/execute
Execute a DML file with parameters.

**Request:**
```json
{
  "dmlFile": "example.dml",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  },
  "streamResults": true
}
```

**Response:**
- If `streamResults: true`: Text stream (chunked transfer encoding)
- If `streamResults: false`: JSON object with output

### POST /api/validate
Validate a DML file.

**Request:**
```json
{
  "dmlFile": "example.dml"
}
```

**Response:**
```json
{
  "valid": true,
  "warnings": [],
  "fileSize": 1234
}
```

## Production Deployment

For production use:

1. Set proper CORS configuration
2. Add authentication/authorization
3. Configure rate limiting
4. Set up monitoring and logging
5. Use a process manager (PM2, systemd)
6. Set up reverse proxy (nginx, Apache)

Example PM2 configuration:
```json
{
  "apps": [{
    "name": "dml-server",
    "script": "index.js",
    "instances": 2,
    "exec_mode": "cluster",
    "env": {
      "NODE_ENV": "production",
      "PORT": 3001
    }
  }]
}
```
