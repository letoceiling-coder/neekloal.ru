# 🚨 DEPLOYMENT CHECKLIST (LOCKED)

## BEFORE DEPLOY

- git status → must be clean
- changes must be committed

## DEPLOY

- git push origin main
- ssh → git pull
- npm run build (apps/web)
- pm2 restart ai-api

## VERIFY

- check commit hash on server
- check dist/assets updated
- check string in bundle:
  "Создайте своё первое видео"

IF NOT FOUND → DEPLOY FAILED
