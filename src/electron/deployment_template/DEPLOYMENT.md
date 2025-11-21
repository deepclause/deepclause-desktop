# {{DEPLOYMENT_NAME}} - Deployment Guide

This guide provides detailed instructions for deploying your DML micro application using different methods.

## Quick Start

Choose the deployment method that best fits your needs:

1. **Docker** - Recommended for production, works anywhere
2. **Vercel** - Fastest deployment, serverless, automatic scaling
3. **Traditional VPS** - Full control, unlimited execution time

## Prerequisites

Before deploying, ensure you have:

- [ ] Built the frontend: `npm run build`
- [ ] Installed backend dependencies: `cd server && npm install`
- [ ] API keys configured (see Environment Variables section)
- [ ] Tested locally with `npm run dev:all`

## 1. Docker Deployment

### Why Docker?

- ✅ Consistent environment across all platforms
- ✅ Easy to scale with orchestration (Kubernetes, Docker Swarm)
- ✅ No vendor lock-in
- ✅ Works on any cloud provider
- ❌ Requires Docker knowledge
- ❌ Infrastructure management needed

### Local Docker Development

```bash
# Build the image
npm run docker:build

# Run with Docker Compose (includes Nginx)
npm run docker:compose:up

# Access the app
open http://localhost
```

### Production Docker Deployment

#### Option 1: Docker Hub + Cloud Platform

1. **Push to Docker Hub:**
```bash
docker login
docker tag {{DEPLOYMENT_NAME}}:latest yourusername/{{DEPLOYMENT_NAME}}:latest
docker push yourusername/{{DEPLOYMENT_NAME}}:latest
```

2. **Deploy on any cloud platform:**
   - AWS ECS/Fargate
   - Google Cloud Run
   - Azure Container Instances
   - DigitalOcean App Platform

#### Option 2: Self-Hosted VPS

1. **Transfer files to server:**
```bash
rsync -avz . user@your-server:/opt/{{DEPLOYMENT_NAME}}
```

2. **On the server:**
```bash
cd /opt/{{DEPLOYMENT_NAME}}
docker-compose up -d
```

3. **Set up reverse proxy (Nginx) on host:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost;
    }
}
```

### Docker Environment Variables

Edit `docker-compose.yml` and add your API keys:

```yaml
environment:
  - OPENAI_API_KEY=sk-...
  - ANTHROPIC_API_KEY=sk-ant-...
  - NODE_ENV=production
```

Or use a `.env` file:

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Then reference in docker-compose.yml:

```yaml
environment:
  - OPENAI_API_KEY=${OPENAI_API_KEY}
  - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

### Docker Troubleshooting

**Container won't start:**
```bash
docker-compose logs -f
```

**Need to rebuild after code changes:**
```bash
docker-compose down
npm run docker:build
docker-compose up -d
```

**Clear all data and restart:**
```bash
docker-compose down -v
docker-compose up -d
```

## 2. Vercel Deployment

### Why Vercel?

- ✅ Zero configuration deployment
- ✅ Automatic HTTPS and custom domains
- ✅ Global CDN for fast loading
- ✅ Automatic scaling
- ✅ Free tier available
- ❌ 300 second execution limit
- ❌ Serverless cold starts
- ❌ No persistent file storage

### Deploy to Vercel

1. **Install Vercel CLI:**
```bash
npm install -g vercel
```

2. **Login to Vercel:**
```bash
vercel login
```

3. **Deploy:**
```bash
npm run vercel:deploy
```

The CLI will guide you through:
- Linking to a Vercel project
- Setting project name
- Configuring build settings

4. **Set Environment Variables:**

Via CLI:
```bash
vercel env add OPENAI_API_KEY
vercel env add ANTHROPIC_API_KEY
```

Or via Vercel Dashboard:
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add your API keys
4. Redeploy

### Vercel Configuration

The `vercel.json` file is pre-configured with:
- Static frontend serving from `dist/`
- Express server deployed as a Node.js function
- 300 second timeout for DML execution
- All API routes handled by the single Express server

The deployment uses Vercel's `@vercel/node` builder to deploy the Express server directly, rather than splitting into multiple serverless functions. This provides:
- Better streaming support
- Simpler code structure
- Shared state during execution
- Consistent behavior with Docker/VPS deployments

### Vercel Limitations

**Execution Time:**
- Maximum 300 seconds per request
- Long-running DML scripts may timeout
- Consider using streaming for progress updates

**Storage:**
- Temporary files stored in `/tmp` (limited to 512MB)
- Files are automatically cleaned up between requests
- Files are temporary and cleaned up after execution
- Use external storage (S3, Cloudinary) for uploaded files

**Cold Starts:**
- First request may be slower (1-2 seconds)
- Subsequent requests are fast
- Can use Vercel Pro for better performance

**Function Size:**
- Vercel has a 50MB limit for serverless functions (uncompressed)
- The DML runtime (SWIPL WebAssembly + mi.qsave) can be large
- If deployment fails due to size, consider:
  - Using Docker deployment instead
  - Hosting SWIPL/runtime files on external CDN
  - Using Vercel Edge Functions (smaller runtime support)
- The `includeFiles` directive in `vercel.json` ensures runtime files are bundled

### Vercel Troubleshooting

**Deployment fails:**
```bash
vercel --debug
```

**Check function logs:**
Visit Vercel dashboard → Your project → Functions tab

**Timeout errors:**
- Reduce DML complexity
- Enable streaming mode
- Consider Docker deployment instead

**"Function size too large" error:**
- Check if `server/runtime/**` files exceed 50MB uncompressed
- Consider Docker deployment for larger runtimes
- Remove Linux VM tool if included (adds ~50MB)

## 3. Traditional VPS Deployment

### Why Traditional VPS?

- ✅ Full control over environment
- ✅ Unlimited execution time
- ✅ Lower cost for high traffic
- ✅ Can run background jobs
- ❌ Manual server management
- ❌ Need to handle scaling
- ❌ Security maintenance required

### Deploy to VPS

1. **Prepare your VPS:**
```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Nginx
sudo apt-get install nginx
```

2. **Transfer files:**
```bash
# From your local machine
rsync -avz --exclude 'node_modules' . user@your-vps:/var/www/{{DEPLOYMENT_NAME}}
```

3. **Install dependencies:**
```bash
ssh user@your-vps
cd /var/www/{{DEPLOYMENT_NAME}}
npm install
cd server && npm install --production
```

4. **Build frontend:**
```bash
npm run build
```

5. **Set up PM2 for process management:**
```bash
sudo npm install -g pm2
cd server
pm2 start index.js --name {{DEPLOYMENT_NAME}}
pm2 save
pm2 startup
```

6. **Configure Nginx:**
```bash
sudo nano /etc/nginx/sites-available/{{DEPLOYMENT_NAME}}
```

Paste the nginx.conf content, then:
```bash
sudo ln -s /etc/nginx/sites-available/{{DEPLOYMENT_NAME}} /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

7. **Set up SSL with Let's Encrypt:**
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### Environment Variables on VPS

Create a `.env` file:
```bash
cd /var/www/{{DEPLOYMENT_NAME}}/server
nano .env
```

Add your variables:
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NODE_ENV=production
```

Load in PM2:
```bash
pm2 restart {{DEPLOYMENT_NAME}} --update-env
```

### VPS Maintenance

**Update the app:**
```bash
cd /var/www/{{DEPLOYMENT_NAME}}
git pull  # or rsync from local
npm run build
pm2 restart {{DEPLOYMENT_NAME}}
```

**Monitor logs:**
```bash
pm2 logs {{DEPLOYMENT_NAME}}
```

**Monitor resources:**
```bash
pm2 monit
```

## Environment Variables Reference

All deployment methods require these environment variables:

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | `sk-proj-...` |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) API key | `sk-ant-...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Backend server port | `3001` |
| `GOOGLE_API_KEY` | Google AI API key | - |
| `MISTRAL_API_KEY` | Mistral AI API key | - |

### Getting API Keys

- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com/
- **Google AI**: https://makersuite.google.com/app/apikey
- **Mistral**: https://console.mistral.ai/

## Choosing the Right Deployment

### Use Docker if:
- You need unlimited execution time
- You want to deploy anywhere
- You need full control
- You're comfortable with Docker

### Use Vercel if:
- You want the fastest deployment
- You don't need long executions (< 5 min)
- You want automatic scaling
- You prefer serverless architecture

### Use Traditional VPS if:
- You need maximum control
- You have existing VPS infrastructure
- You want to minimize costs at scale
- You need custom system configurations

## Support

For deployment issues:
- Check the logs first
- Verify environment variables are set
- Test locally before deploying
- Consult platform-specific documentation

For DML-specific issues:
- Review the DML file for errors
- Check API key validity
- Monitor API rate limits
- Ensure all dependencies are installed
