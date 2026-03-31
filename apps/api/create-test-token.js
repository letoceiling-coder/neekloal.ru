require("dotenv").config();
const { signAccessToken } = require("./src/lib/jwt");
const p = require("./src/lib/prisma");

async function main() {
  const user = await p.user.findFirst({ where: { role: "root" } });
  if (!user) throw new Error("No root user found");

  // Get org from membership
  const membership = await p.membership.findFirst({
    where: { userId: user.id, deletedAt: null },
    select: { organizationId: true },
  });
  const orgId = membership?.organizationId || user.organizationId;
  if (!orgId) throw new Error("User has no organization");

  const token = signAccessToken({ userId: user.id, organizationId: orgId });
  console.log("TOKEN:" + token);
  console.log("EMAIL:" + user.email);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
