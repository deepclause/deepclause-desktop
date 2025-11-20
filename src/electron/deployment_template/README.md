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

1. Install frontend dependencies:
```bash
npm install
```

2. Install backend server dependencies:
```bash
cd server
npm install
cd ..
```

### Running the Application

The micro app requires both a frontend (React + Vite) and a backend server (Express) to run.

**Option 1: Run with two terminal windows (recommended for development)**

Terminal 1 - Start the backend server:
```bash
cd server
npm run dev
```

Terminal 2 - Start the frontend:
```bash
npm run dev
```

**Option 2: Run with a single command (using background process)**

```bash
cd server && npm run dev & cd .. && npm run dev
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

### Deploy to Static Hosting

The built application in `dist/` can be deployed to any static hosting service:

- **Netlify**: Drag and drop the `dist` folder
- **Vercel**: Run `vercel --prod` in the project directory
- **GitHub Pages**: Push the `dist` folder to a `gh-pages` branch
- **AWS S3**: Upload the `dist` folder contents to an S3 bucket

### Deploy with Backend

To use the DML execution backend, you'll need to:

1. Set up the DML runtime server (see backend setup below)
2. Configure the API endpoint in `src/config.ts`
3. Deploy both the frontend and backend

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
│   │   └── ExecutionHistory.tsx # History of executions
│   ├── dml/                # DML-related files
│   │   └── {{DML_FILE_NAME}}   # The deployed DML file
│   ├── services/           # API services
│   │   └── dmlExecutor.ts     # DML execution service
│   ├── App.tsx             # Main application component
│   ├── main.tsx            # Application entry point
│   └── config.ts           # Configuration file
├── server/                 # Optional standalone backend
│   ├── index.js            # Express server for DML execution
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
