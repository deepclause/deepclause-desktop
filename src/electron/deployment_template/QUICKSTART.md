# Quick Start Guide - {{DEPLOYMENT_NAME}}

This is a standalone DML micro application. Choose your preferred deployment method:

## 🚀 Fastest: Vercel (30 seconds)

```bash
npm install -g vercel
vercel --prod
```

Set your API keys in Vercel dashboard, then access your app at the provided URL.

## 🐳 Production: Docker (2 minutes)

```bash
# Edit docker-compose.yml and add your API keys
npm run docker:compose:up
```

Access your app at http://localhost

## 💻 Development: Local (1 minute)

```bash
# Terminal 1
cd server && npm install && npm run dev

# Terminal 2  
npm install && npm run dev
```

Access your app at http://localhost:5173

---

## Environment Variables Needed

Before deploying, you need:

- `OPENAI_API_KEY` - Get from https://platform.openai.com/api-keys
- `ANTHROPIC_API_KEY` - Get from https://console.anthropic.com/

## Full Documentation

- [README.md](README.md) - Complete project documentation
- [DEPLOYMENT.md](DEPLOYMENT.md) - Detailed deployment guide for all methods

## Troubleshooting

**API Errors?** Check that your API keys are set correctly.
**Build Errors?** Make sure you've run `npm install` in both root and `server/` directories.
**Can't connect to server?** Verify the backend is running on port 3001.

## Support

For issues specific to:
- **DML execution**: Check the DML file syntax
- **Deployment**: See DEPLOYMENT.md for platform-specific guides
- **API integration**: Verify your API keys and model settings
