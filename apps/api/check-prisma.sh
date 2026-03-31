#!/bin/bash
cd /var/www/site-al.ru/apps/api
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const models = Object.keys(p).filter(k => !k.startsWith('_') && !k.startsWith('\$'));
console.log('Prisma models available:', models.join(', '));
const hasAvito = models.filter(m => m.toLowerCase().includes('avito'));
console.log('Avito models:', hasAvito.join(', ') || 'NONE');
process.exit(0);
"
