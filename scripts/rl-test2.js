const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

async function main() {
  // Get any user who is an OWNER member
  const membership = await prisma.membership.findFirst({ where: { role: 'OWNER' }, include: { user: true } });
  const asst = await prisma.assistant.findFirst({});
  if (!membership || !asst) { console.error('ERROR: no membership/asst'); process.exit(1); }
  const user = membership.user;
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
  console.log(token + '|' + asst.id);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
