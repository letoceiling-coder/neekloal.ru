const j = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const m = await p.membership.findFirst({ where: { deletedAt: null } });
  if (!m) { console.log("NO MEMBERSHIP"); process.exit(1); }
  const token = j.sign(
    { userId: m.userId, organizationId: m.organizationId },
    process.env.JWT_SECRET || "secret",
    { expiresIn: "1h" }
  );
  process.stdout.write(token);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
