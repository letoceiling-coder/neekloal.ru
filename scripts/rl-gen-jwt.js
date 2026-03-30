require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

async function main() {
  const membership = await prisma.membership.findFirst({ where: { role: 'OWNER' }, include: { user: true } });
  const asst = await prisma.assistant.findFirst({});
  if (!membership || !asst) { console.error('no data'); process.exit(1); }
  const secret = process.env.JWT_SECRET;
  if (!secret) { console.error('no JWT_SECRET'); process.exit(1); }
  const token = jwt.sign({ userId: membership.user.id }, secret, { expiresIn: '1h' });
  console.log('JWT=' + token);
  console.log('ASST=' + asst.id);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
