# {{DEPLOYMENT_NAME}}

A standalone micro web application for executing DML (DeepClause Meta Language) files.

## About

This application provides a web interface for:
- Viewing and configuring parameters for the DML file: `{{DML_FILE_NAME}}`
- Executing the DML with user-provided inputs
- Streaming results in real-time
- Viewing execution history

## DML File Information

**File:** `{{DML_FILE_NAME}}`

**Description:** {{DML_DESCRIPTION}}

**Parameters:**
{{PARAMETERS_LIST}}

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. Install dependencies (this installs both frontend and backend dependencies):
```bash
npm install
```

### Running the Application

The micro app requires both a frontend (React + Vite) and a backend server (Express) to run.

**Option 1: Run with two terminal windows (recommended for development)**

Terminal 1 - Start the backend server:
```bash
npm run dev:server
```

Terminal 2 - Start the frontend:
```bash
npm run dev
```

**Option 2: Run with a single command (using background process)**

```bash
npm run dev:all
```

The application will be available at:
- **Frontend**: `http://localhost:5174`
- **Backend API**: `http://localhost:3001`

### Building for Production

Build the frontend application:

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Serving the Production Build

Preview the production build locally:

```bash
npm run preview
```

## Deployment

This application can be deployed in multiple ways depending on your needs:

### 1. Docker Deployment (Recommended for Production)

Docker provides a containerized, reproducible deployment that works anywhere Docker is available.

#### Quick Start with Docker

**Option A: Using Docker Compose (Easiest)**

1. Build and start the application:
```bash
npm run docker:compose:up
```

2. Access the application:
   - **Frontend + API**: http://localhost (via Nginx)
   - **Direct API**: http://localhost:3001

3. View logs:
```bash
npm run docker:compose:logs
```

4. Stop the application:
```bash
npm run docker:compose:down
```

**Option B: Using Docker directly**

1. Build the Docker image:
```bash
npm run docker:build
```

2. Run the container:
```bash
npm run docker:run
```

Or with environment variables:
```bash
docker run -p 3001:3001 \
  -e OPENAI_API_KEY=your_key_here \
  -e ANTHROPIC_API_KEY=your_key_here \
  {{DEPLOYMENT_NAME}}:latest
```

#### Deploy to Cloud Platforms

**Deploy to AWS ECS/Fargate:**
```bash
# Tag and push to ECR
docker tag {{DEPLOYMENT_NAME}}:latest your-ecr-registry/{{DEPLOYMENT_NAME}}:latest
docker push your-ecr-registry/{{DEPLOYMENT_NAME}}:latest
# Then create an ECS service using this image
```

**Deploy to Google Cloud Run:**
```bash
# Tag and push to GCR
docker tag {{DEPLOYMENT_NAME}}:latest gcr.io/your-project/{{DEPLOYMENT_NAME}}:latest
docker push gcr.io/your-project/{{DEPLOYMENT_NAME}}:latest
gcloud run deploy {{DEPLOYMENT_NAME}} --image gcr.io/your-project/{{DEPLOYMENT_NAME}}:latest
```

**Deploy to Azure Container Instances:**
```bash
az container create \
  --resource-group myResourceGroup \
  --name {{DEPLOYMENT_NAME}} \
  --image {{DEPLOYMENT_NAME}}:latest \
  --dns-name-label {{DEPLOYMENT_NAME}} \
  --ports 3001
```

### 2. Vercel Deployment (Serverless)

Vercel provides zero-configuration deployment with automatic HTTPS and global CDN.

#### Prerequisites

Install Vercel CLI:
```bash
npm install -g vercel
```

#### Deploy to Vercel

1. Build the application:
```bash
npm run build
```

2. Deploy to Vercel:
```bash
npm run vercel:deploy
```

Or simply:
```bash
vercel --prod
```

3. Set environment variables in Vercel dashboard:
   - Go to your project settings
   - Add environment variables (API keys, etc.)
   - Redeploy if needed

#### Vercel Configuration

The deployment includes:
- Static frontend served from CDN
- Serverless API functions in `/api` directory
- Automatic HTTPS and custom domains
- Global edge network

**Note on Vercel Deployment:**
- Uses single Express server deployed via `@vercel/node`
- Maximum execution time: 300 seconds
- Temporary storage in `/tmp` (512MB limit)
- Cold starts may add latency to first request
- Automatic HTTPS and CDN distribution

The Vercel deployment uses the same Express server as Docker/VPS deployments, ensuring consistent behavior across all platforms.

### 3. Traditional Hosting

For deployments to VPS, dedicated servers, or traditional hosting:

1. Build the frontend:
```bash
npm run build
```

2. Install and start the backend server:
```bash
cd server
npm install --production
npm start
```

3. Serve the `dist/` folder with Nginx, Apache, or any static file server

4. Configure reverse proxy to forward `/api/*` to the backend server

Example Nginx configuration is included in `nginx.conf`.

### Deployment Comparison

| Feature | Docker | Vercel | Traditional VPS |
|---------|--------|--------|-----------------|
| **Setup Complexity** | Medium | Easy | Hard |
| **Scaling** | Manual/Orchestration | Automatic | Manual |
| **Cost** | Infrastructure cost | Pay per use | Fixed monthly |
| **Cold Starts** | None | Yes | None |
| **Max Execution Time** | Unlimited | 300s | Unlimited |
| **Environment Control** | Full | Limited | Full |
| **HTTPS** | Manual setup | Automatic | Manual setup |
| **Best For** | Production apps | Prototypes, demos | Custom requirements |

### Environment Variables

All deployment methods require environment variables for API keys:

**Required:**
- `OPENAI_API_KEY` - For OpenAI models
- `ANTHROPIC_API_KEY` - For Claude models

**Optional:**
- `GOOGLE_API_KEY` - For Google models
- `MISTRAL_API_KEY` - For Mistral models
- Other API keys as needed by your DML file

**Setting Environment Variables:**

**Docker:** Add to `docker-compose.yml` or use `-e` flag
**Vercel:** Set in project settings dashboard
**Traditional:** Use `.env` file or system environment

## Backend Setup

The micro app requires a backend service to execute DML code. You have two options:

### Option 1: Use Existing DeepClause Installation

If you have DeepClause installed locally or on a server:

1. Start the DeepClause server
2. Update `src/config.ts` with the server URL
3. Ensure CORS is configured to allow requests from your deployment

### Option 2: Standalone DML Runtime Server

A minimal Node.js server is included in `server/` directory:

```bash
cd server
npm install
npm start
```

This server provides the DML execution API at `http://localhost:3001`

## Project Structure

```
{{DEPLOYMENT_NAME}}/
├── src/
│   ├── components/          # React components
│   │   ├── ParameterForm.tsx   # DML parameter input form
│   │   ├── ResultsViewer.tsx   # DML execution results display
│   │   ├── ExecutionHistory.tsx # History of executions
│   │   └── MermaidDiagram.tsx  # Mermaid diagram renderer
│   ├── dml/                # DML-related files
│   │   └── {{DML_FILE_NAME}}   # The deployed DML file
│   ├── App.tsx             # Main application component
│   ├── main.tsx            # Application entry point
│   └── config.ts           # Configuration file
├── server/                 # Backend server
│   ├── index.js            # Express server (works for all deployments)
│   ├── runtime/            # DML runtime files
│   │   ├── mi.qsave           # Prolog saved state
│   │   ├── dml-core/          # Core Prolog modules
│   │   └── dml-js/            # JavaScript bridge
│   └── vendor/             # Dependencies
│       └── swipl-wasm/        # WebAssembly Prolog
│   └── package.json
├── public/                 # Static assets
├── index.html
├── package.json
└── vite.config.js

## Configuration

Edit `src/config.ts` to configure:

- API endpoint URL
- DML execution timeout
- Streaming options
- UI theme settings

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **React Markdown** - Markdown rendering for DML outputs
- **Mermaid** - Diagram rendering

## License

This deployment is based on DeepClause DML technology.

## Support

For issues with:
- DML execution: Check the DeepClause documentation
- This micro app: Create an issue in the repository
- Deployment: Consult your hosting provider's documentation
