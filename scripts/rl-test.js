const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { platformRole: 'ROOT' } });
  const asst = await prisma.assistant.findFirst({});
  if (!user || !asst) { console.error('ERROR: no user/asst'); process.exit(1); }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
  console.log(token + '|' + asst.id);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
